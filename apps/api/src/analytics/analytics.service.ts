import { Inject, Injectable } from "@nestjs/common";
import { and, breakdownDaily, clickDaily, conversions, desc, eq, gte, links, lt, sql, type Database } from "@snapurl/database";
import type { Analytics, AnalyticsQuery, Breakdown, TimeseriesPoint } from "@snapurl/contract";
import { DB } from "../database/database.module.js";

const RANGE_DAYS: Record<string, number> = { "24h": 1, "7d": 7, "30d": 30, "90d": 90, "12m": 365 };

/* Country codes the fixtures render with flags. Anything not listed falls back
   to a globe rather than showing a broken flag glyph. */
const FLAGS: Record<string, string> = {
  IN: "🇮🇳", US: "🇺🇸", GB: "🇬🇧", AE: "🇦🇪", SG: "🇸🇬", AU: "🇦🇺", CA: "🇨🇦",
  DE: "🇩🇪", FR: "🇫🇷", JP: "🇯🇵", BR: "🇧🇷", NL: "🇳🇱", ZA: "🇿🇦", ID: "🇮🇩",
};

const COUNTRY_NAMES: Record<string, string> = {
  IN: "India", US: "United States", GB: "United Kingdom", AE: "UAE", SG: "Singapore",
  AU: "Australia", CA: "Canada", DE: "Germany", FR: "France", JP: "Japan",
  BR: "Brazil", NL: "Netherlands", ZA: "South Africa", ID: "Indonesia",
};

@Injectable()
export class AnalyticsService {
  constructor(@Inject(DB) private readonly db: Database) {}

  /* Everything here reads rollup tables, never click_events.

     Aggregating raw rows on page load is fine at a thousand clicks and
     unusable at ten million; the rollups exist precisely so this endpoint's
     cost is bounded by the date range rather than by traffic. */
  async overview(workspaceId: string, query: AnalyticsQuery): Promise<Analytics> {
    const days = RANGE_DAYS[query.range] ?? 30;
    const { start, previousStart } = windowFor(days);

    const scope = query.linkId ? and(eq(clickDaily.workspaceId, workspaceId), eq(clickDaily.linkId, query.linkId)) : eq(clickDaily.workspaceId, workspaceId);

    const [current] = await this.db
      .select({
        clicks: sql<number>`coalesce(sum(${clickDaily.clicks}), 0)::int`,
        unique: sql<number>`coalesce(sum(${clickDaily.uniques}), 0)::int`,
        scans: sql<number>`coalesce(sum(${clickDaily.scans}), 0)::int`,
        blocked: sql<number>`coalesce(sum(${clickDaily.blocked}), 0)::int`,
      })
      .from(clickDaily)
      .where(and(scope, gte(clickDaily.day, iso(start))));

    const [previous] = await this.db
      .select({
        clicks: sql<number>`coalesce(sum(${clickDaily.clicks}), 0)::int`,
        unique: sql<number>`coalesce(sum(${clickDaily.uniques}), 0)::int`,
        scans: sql<number>`coalesce(sum(${clickDaily.scans}), 0)::int`,
      })
      .from(clickDaily)
      .where(and(scope, gte(clickDaily.day, iso(previousStart)), lt(clickDaily.day, iso(start))));

    const series = await this.db
      .select({
        date: clickDaily.day,
        clicks: sql<number>`coalesce(sum(${clickDaily.clicks}), 0)::int`,
        unique: sql<number>`coalesce(sum(${clickDaily.uniques}), 0)::int`,
        scans: sql<number>`coalesce(sum(${clickDaily.scans}), 0)::int`,
      })
      .from(clickDaily)
      .where(and(scope, gte(clickDaily.day, iso(start))))
      .groupBy(clickDaily.day)
      .orderBy(clickDaily.day);

    const [countries, devices, browsers, referrers] = await Promise.all([
      this.breakdown(workspaceId, "country", start, query.linkId),
      this.breakdown(workspaceId, "device", start, query.linkId),
      this.breakdown(workspaceId, "browser", start, query.linkId),
      this.breakdown(workspaceId, "referrer", start, query.linkId),
    ]);

    const [tags, topLinks] = await Promise.all([
      this.tagBreakdown(workspaceId, start),
      this.topLinks(workspaceId, start),
    ]);

    /* Conversions live in their own table rather than the click rollups, so
       the stat tile needs its own count. Without this the analytics page reads
       zero while the conversions page reports hundreds — the kind of
       contradiction that makes someone stop trusting both numbers. */
    const [conversionTotals] = await this.db
      .select({ n: sql<number>`count(*)::int` })
      .from(conversions)
      .where(
        and(
          eq(conversions.workspaceId, workspaceId),
          gte(conversions.occurredAt, start),
          ...(query.linkId ? [eq(conversions.linkId, query.linkId)] : []),
        ),
      );

    const [previousConversions] = await this.db
      .select({ n: sql<number>`count(*)::int` })
      .from(conversions)
      .where(
        and(
          eq(conversions.workspaceId, workspaceId),
          gte(conversions.occurredAt, previousStart),
          lt(conversions.occurredAt, start),
          ...(query.linkId ? [eq(conversions.linkId, query.linkId)] : []),
        ),
      );

    const conversionCount = conversionTotals?.n ?? 0;

    return {
      totals: {
        clicks: current?.clicks ?? 0,
        unique: current?.unique ?? 0,
        scans: current?.scans ?? 0,
        conversions: conversionCount,
        blocked: current?.blocked ?? 0,
      },
      deltas: {
        clicks: percentChange(previous?.clicks ?? 0, current?.clicks ?? 0),
        unique: percentChange(previous?.unique ?? 0, current?.unique ?? 0),
        scans: percentChange(previous?.scans ?? 0, current?.scans ?? 0),
        conversions: percentChange(previousConversions?.n ?? 0, conversionCount),
      },
      series: fillSeries(series as TimeseriesPoint[], start, days),
      countries: countries.map((c) => ({
        label: COUNTRY_NAMES[c.label] ?? c.label,
        value: c.value,
        icon: FLAGS[c.label] ?? "🌐",
      })),
      devices,
      browsers,
      referrers,
      tags,
      topLinks,
    };
  }

  private async breakdown(workspaceId: string, dimension: string, start: Date, linkId?: string): Promise<Breakdown[]> {
    const filters = [
      eq(breakdownDaily.workspaceId, workspaceId),
      eq(breakdownDaily.dimension, dimension),
      gte(breakdownDaily.day, iso(start)),
    ];
    if (linkId) filters.push(eq(breakdownDaily.linkId, linkId));

    const rows = await this.db
      .select({ label: breakdownDaily.value, value: sql<number>`sum(${breakdownDaily.count})::int` })
      .from(breakdownDaily)
      .where(and(...filters))
      .groupBy(breakdownDaily.value)
      .orderBy(desc(sql`sum(${breakdownDaily.count})`))
      .limit(8);

    return rows.map((r) => ({ label: r.label, value: r.value }));
  }

  /** Tags live on the link, not on the click, so this joins rather than
   *  reading a breakdown row. A click inherits whatever tags the link has now. */
  private async tagBreakdown(workspaceId: string, start: Date): Promise<Breakdown[]> {
    const rows = await this.db
      .select({ label: sql<string>`tag`, value: sql<number>`sum(${clickDaily.clicks})::int` })
      .from(clickDaily)
      .innerJoin(links, eq(clickDaily.linkId, links.id))
      .innerJoin(sql`unnest(${links.tags}) as tag`, sql`true`)
      .where(and(eq(clickDaily.workspaceId, workspaceId), gte(clickDaily.day, iso(start))))
      .groupBy(sql`tag`)
      .orderBy(desc(sql`sum(${clickDaily.clicks})`))
      .limit(8);
    return rows.map((r) => ({ label: r.label, value: r.value }));
  }

  private async topLinks(workspaceId: string, start: Date): Promise<Breakdown[]> {
    const rows = await this.db
      .select({ slug: links.slug, value: sql<number>`sum(${clickDaily.clicks})::int` })
      .from(clickDaily)
      .innerJoin(links, eq(clickDaily.linkId, links.id))
      .where(and(eq(clickDaily.workspaceId, workspaceId), gte(clickDaily.day, iso(start))))
      .groupBy(links.slug)
      .orderBy(desc(sql`sum(${clickDaily.clicks})`))
      .limit(8);
    return rows.map((r) => ({ label: r.slug, value: r.value }));
  }
}

export function iso(d: Date): string {
  return d.toISOString().slice(0, 10);
}

/** The previous window is the same length immediately before, so a 30-day
 *  delta compares against the 30 days before that, not against a calendar month. */
export function windowFor(days: number) {
  const start = new Date();
  start.setUTCHours(0, 0, 0, 0);
  start.setUTCDate(start.getUTCDate() - days + 1);
  const previousStart = new Date(start);
  previousStart.setUTCDate(previousStart.getUTCDate() - days);
  return { start, previousStart };
}

/** Growing from zero is reported as +100%, not as infinity. */
export function percentChange(before: number, after: number): number {
  if (before === 0) return after === 0 ? 0 : 100;
  return Math.round(((after - before) / before) * 1000) / 10;
}

/** Zero-fill missing days so the chart's x-axis is continuous — a gap would
 *  otherwise be drawn as a straight line between two distant points. */
export function fillSeries(rows: TimeseriesPoint[], start: Date, days: number): TimeseriesPoint[] {
  const byDate = new Map(rows.map((r) => [r.date, r]));
  const out: TimeseriesPoint[] = [];
  for (let i = 0; i < days; i++) {
    const d = new Date(start);
    d.setUTCDate(d.getUTCDate() + i);
    const key = iso(d);
    out.push(byDate.get(key) ?? { date: key, clicks: 0, unique: 0, scans: 0 });
  }
  return out;
}
