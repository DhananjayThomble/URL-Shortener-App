import { Inject, Injectable } from "@nestjs/common";
import type {
  AdminAnalyticsComparable,
  AdminAnalyticsQuery,
  AdminAnalyticsRange,
  AdminSeriesPoint,
  PlatformAnalytics,
} from "@snapurl/contract";
import {
  ADMIN_ANALYTICS_READER,
  type AdminAnalyticsReader,
  type DayPoint,
} from "./admin-analytics.reader.js";
import { EMAIL_STATS_READER, type EmailStatsReader } from "./email-stats.reader.js";

/* ============================================================
   #973 — platform-wide analytics (admin panel 6/7).

   The operator's view of the whole platform, built entirely from the daily
   SUMMARY tables (never a scan of click_events) via AdminAnalyticsReader, plus
   SES figures via EmailStatsReader. Every number here is the same question the
   per-workspace /analytics answers, asked across all workspaces: so by
   construction the platform totals equal the SUM of the per-workspace figures
   for the same range. clicksByWorkspace() exposes that decomposition and the
   integration test asserts the equality directly.

   All store-agnostic shaping — the window math, the zero-filled series, the
   top-N slices, the near-limit rule, the retention offsets, the
   period-over-period comparison — lives here, exactly as it does in
   AnalyticsService. The readers only read.
   ============================================================ */

const RANGE_DAYS: Record<AdminAnalyticsRange, number> = { "7d": 7, "30d": 30, "90d": 90, "12m": 365 };

/** How many rows the ranked tables show. */
const TOP_N = 10;

/** A workspace is "near its limit" at or above this fraction of its included
 *  click allowance for the window. 0.8 = 80%. */
const NEAR_LIMIT_FRACTION = 0.8;

/** The retention offsets the growth view reports, in weeks. */
const RETENTION_WEEKS = [1, 2, 4];

interface Window {
  /** Inclusive first day, `YYYY-MM-DD`. */
  start: string;
  /** Inclusive last day, `YYYY-MM-DD` (what the response reports). */
  endInclusive: string;
  /** Exclusive upper bound, `YYYY-MM-DD` (what the reader queries with). */
  end: string;
}

@Injectable()
export class AdminAnalyticsService {
  constructor(
    @Inject(ADMIN_ANALYTICS_READER) private readonly reader: AdminAnalyticsReader,
    @Inject(EMAIL_STATS_READER) private readonly email: EmailStatsReader,
  ) {}

  async platform(query: AdminAnalyticsQuery): Promise<PlatformAnalytics> {
    const days = RANGE_DAYS[query.range];
    const current = windowFor(days);

    const [
      signups,
      signupsSeries,
      newWorkspaces,
      activeUsers,
      activeDaily,
      activeWeekly,
      activeMonthly,
      retention,
      linksCreated,
      clickTotals,
      clicksSeries,
      topWorkspaces,
      topLinks,
      byCountry,
      byDevice,
      byBrowser,
      byReferrer,
      byPlan,
      workspaceUsage,
      reports,
      reportsByWeek,
      resolved,
      emailStats,
    ] = await Promise.all([
      this.reader.signups(current.start, current.end),
      this.reader.signupsByDay(current.start, current.end),
      this.reader.newWorkspaces(current.start, current.end),
      this.reader.activeUsers(current.start, current.end),
      // Active users over trailing day / week / month, independent of the range.
      this.reader.activeUsers(...trailing(1)),
      this.reader.activeUsers(...trailing(7)),
      this.reader.activeUsers(...trailing(30)),
      Promise.all(
        RETENTION_WEEKS.map(async (weeks) => ({
          weeks,
          ...(await this.reader.retentionAfterWeeks(current.start, current.end, weeks)),
        })),
      ),
      this.reader.linksCreated(current.start, current.end),
      this.reader.clickTotals(current.start, current.end),
      this.reader.clicksByDay(current.start, current.end),
      this.reader.topWorkspaces(current.start, current.end, TOP_N),
      this.reader.topLinks(current.start, current.end, TOP_N),
      this.reader.breakdown("country", current.start, current.end),
      this.reader.breakdown("device", current.start, current.end),
      this.reader.breakdown("browser", current.start, current.end),
      this.reader.breakdown("referrer", current.start, current.end),
      this.reader.workspacesByPlan(),
      this.reader.workspaceUsage(current.start, current.end),
      this.reader.reportsFiled(current.start, current.end),
      this.reader.reportsByWeek(current.start, current.end),
      this.reader.resolvedReports(current.start, current.end),
      this.email.stats(current.start, current.end),
    ]);

    const nearLimit = workspaceUsage
      .filter((w) => w.included > 0 && w.clicks / w.included >= NEAR_LIMIT_FRACTION)
      .map((w) => ({
        workspace: w.workspace,
        plan: w.plan,
        clicks: w.clicks,
        included: w.included,
        usedFraction: Math.round((w.clicks / w.included) * 100) / 100,
      }))
      .sort((a, b) => b.usedFraction - a.usedFraction);

    const result: PlatformAnalytics = {
      range: query.range,
      window: { start: current.start, end: current.endInclusive },
      growth: {
        signups,
        newWorkspaces,
        activeUsers,
        signupsSeries: fillSeries(signupsSeries, current),
        activeDaily,
        activeWeekly,
        activeMonthly,
        retention,
      },
      usage: {
        linksCreated,
        totalClicks: clickTotals.clicks,
        uniqueVisitors: clickTotals.unique,
        clicksSeries: fillSeries(clicksSeries, current),
        topWorkspaces,
        topLinks,
        byCountry: byCountry.slice(0, TOP_N),
        byDevice: byDevice.slice(0, TOP_N),
        byBrowser: byBrowser.slice(0, TOP_N),
        byReferrer: byReferrer.slice(0, TOP_N),
      },
      business: { byPlan, nearLimit },
      email: {
        available: emailStats.available,
        sends: emailStats.sends,
        bounces: emailStats.bounces,
        complaints: emailStats.complaints,
        bounceRate: rate(emailStats.bounces, emailStats.sends),
        complaintRate: rate(emailStats.complaints, emailStats.sends),
      },
      abuse: {
        reports,
        reportsByWeek,
        resolved: resolved.resolved,
        avgResolutionHours: resolved.avgResolutionHours,
      },
    };

    if (query.compare) {
      result.previous = await this.comparable(previousWindow(current, days));
    }

    return result;
  }

  /** The headline scalars for a window, for the period-over-period block. */
  private async comparable(w: Window): Promise<AdminAnalyticsComparable> {
    const [signups, newWorkspaces, activeUsers, linksCreated, clickTotals, reports] = await Promise.all([
      this.reader.signups(w.start, w.end),
      this.reader.newWorkspaces(w.start, w.end),
      this.reader.activeUsers(w.start, w.end),
      this.reader.linksCreated(w.start, w.end),
      this.reader.clickTotals(w.start, w.end),
      this.reader.reportsFiled(w.start, w.end),
    ]);
    return {
      signups,
      newWorkspaces,
      activeUsers,
      linksCreated,
      totalClicks: clickTotals.clicks,
      uniqueVisitors: clickTotals.unique,
      reports,
    };
  }

  /**
   * The CSV for one view.
   *
   * A read, not a write — nothing here touches the admin audit log. Returns a
   * complete CSV string (small, bounded tables: the ranked lists and the
   * series), RFC-4180-escaped. The controller streams it with a text/csv
   * Content-Disposition.
   */
  async csv(query: AdminAnalyticsQuery, view: string): Promise<string> {
    const data = await this.platform(query);
    switch (view) {
      case "growth":
        return toCsv(["date", "signups"], data.growth.signupsSeries.map((p) => [p.date, p.value]));
      case "usage":
        return toCsv(["date", "clicks"], data.usage.clicksSeries.map((p) => [p.date, p.value]));
      case "topWorkspaces":
        return toCsv(["workspace", "clicks"], data.usage.topWorkspaces.map((r) => [r.label, r.value]));
      case "topLinks":
        return toCsv(["link", "clicks"], data.usage.topLinks.map((r) => [r.label, r.value]));
      case "business":
        return toCsv(
          ["workspace", "plan", "clicks", "included", "usedFraction"],
          data.business.nearLimit.map((w) => [w.workspace, w.plan, w.clicks, w.included, w.usedFraction]),
        );
      case "abuse":
        return toCsv(["week", "reports"], data.abuse.reportsByWeek.map((r) => [r.label, r.value]));
      default:
        // The controller validates `view` against the zod enum before reaching
        // here, so this is unreachable; kept exhaustive so a new view that
        // forgets a case fails loudly rather than returning an empty file.
        throw new Error(`Unknown CSV view: ${view}`);
    }
  }
}

/** The window for the last `days` days ending today (UTC), both ends as
 *  `YYYY-MM-DD`. `end` is exclusive (the day after today). */
export function windowFor(days: number, now: Date = new Date()): Window {
  const endExclusive = new Date(now);
  endExclusive.setUTCHours(0, 0, 0, 0);
  endExclusive.setUTCDate(endExclusive.getUTCDate() + 1); // tomorrow 00:00 — today is included
  const start = new Date(endExclusive);
  start.setUTCDate(start.getUTCDate() - days);
  const endInclusive = new Date(endExclusive);
  endInclusive.setUTCDate(endInclusive.getUTCDate() - 1);
  return { start: iso(start), end: iso(endExclusive), endInclusive: iso(endInclusive) };
}

/** The window of equal length immediately before `w`. */
export function previousWindow(w: Window, days: number): Window {
  const end = new Date(w.start); // previous window ends where the current one starts (exclusive)
  const start = new Date(end);
  start.setUTCDate(start.getUTCDate() - days);
  const endInclusive = new Date(end);
  endInclusive.setUTCDate(endInclusive.getUTCDate() - 1);
  return { start: iso(start), end: iso(end), endInclusive: iso(endInclusive) };
}

/** A trailing [start, end) window of `days` ending at tomorrow 00:00 UTC, as a
 *  tuple for spreading into reader.activeUsers(). */
function trailing(days: number): [string, string] {
  const w = windowFor(days);
  return [w.start, w.end];
}

export function iso(d: Date): string {
  return d.toISOString().slice(0, 10);
}

/** Zero-fill every day of the window so a series is a continuous line rather
 *  than one that jumps over quiet days. */
export function fillSeries(rows: DayPoint[], w: Window): AdminSeriesPoint[] {
  const byDate = new Map(rows.map((r) => [r.date, r.value]));
  const out: AdminSeriesPoint[] = [];
  const cursor = new Date(w.start);
  const end = new Date(w.end);
  while (cursor < end) {
    const key = iso(cursor);
    out.push({ date: key, value: byDate.get(key) ?? 0 });
    cursor.setUTCDate(cursor.getUTCDate() + 1);
  }
  return out;
}

/** A rate as a fraction of the denominator, rounded to 4 dp, or null when the
 *  numerator or denominator is null/zero (no basis to divide). */
function rate(numerator: number | null, denominator: number | null): number | null {
  if (numerator == null || denominator == null || denominator === 0) return null;
  return Math.round((numerator / denominator) * 10000) / 10000;
}

/** RFC-4180 CSV: fields containing a comma, quote or newline are wrapped in
 *  double quotes with embedded quotes doubled. */
function toCsv(header: string[], rows: Array<Array<string | number>>): string {
  const lines = [header, ...rows].map((cols) => cols.map(csvCell).join(","));
  return lines.join("\r\n") + "\r\n";
}

function csvCell(value: string | number): string {
  const s = String(value);
  return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}
