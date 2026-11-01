import {
  abuseReports,
  and,
  breakdownDaily,
  clickDaily,
  conversions,
  desc,
  gte,
  links,
  lt,
  memberships,
  sql,
  users,
  workspaces,
  type Database,
} from "@snapurl/database";

/* ============================================================
   #973 — the platform-analytics READ path, behind a port.

   Same shape of seam as apps/api/src/analytics/analytics.reader.ts: the service
   holds all the store-agnostic logic (period math, zero-filling, totals, the
   top-N slice, retention), and this adapter does nothing but read the SUMMARY
   tables. Every query here is bounded by a date range and reads click_daily /
   breakdown_daily / users / workspaces / memberships / conversions /
   abuse_reports — NEVER a full scan of click_events. That is the whole point of
   the rollups: platform-wide figures stay cheap no matter how much traffic the
   platform has seen.

   `start` is an inclusive `YYYY-MM-DD`; `end` is the EXCLUSIVE upper bound
   (the day after the last day in the window), so a window is [start, end). The
   service computes both from the range.
   ============================================================ */

/** The DI token bound to PostgresAdminAnalyticsReader off the read replica. */
export const ADMIN_ANALYTICS_READER = Symbol("ADMIN_ANALYTICS_READER");

/** A ranked (label, value) row. */
export interface RankRow {
  label: string;
  value: number;
}

/** One day of a platform-wide daily series; `date` is `YYYY-MM-DD`. */
export interface DayPoint {
  date: string;
  value: number;
}

/** A workspace's clicks in the window against its included allowance, for the
 *  near-limit list. */
export interface WorkspaceUsageRow {
  workspace: string;
  plan: string;
  clicks: number;
  included: number;
}

export interface AdminAnalyticsReader {
  /* ── growth ── */
  signups(start: string, end: string): Promise<number>;
  signupsByDay(start: string, end: string): Promise<DayPoint[]>;
  newWorkspaces(start: string, end: string): Promise<number>;
  /** Distinct users active (membership.last_active_at) in [start, end). */
  activeUsers(start: string, end: string): Promise<number>;
  /** Users who signed up in [start, end) AND were active at least `weeks`
   *  after their own signup. Returns {retained, cohort}. */
  retentionAfterWeeks(start: string, end: string, weeks: number): Promise<{ retained: number; cohort: number }>;

  /* ── usage ── */
  linksCreated(start: string, end: string): Promise<number>;
  /** Platform click/unique totals over the window, from click_daily. */
  clickTotals(start: string, end: string): Promise<{ clicks: number; unique: number }>;
  clicksByDay(start: string, end: string): Promise<DayPoint[]>;
  /** Top workspaces by clicks in the window (labelled by workspace name). */
  topWorkspaces(start: string, end: string, limit: number): Promise<RankRow[]>;
  /** Top links by clicks in the window (labelled by slug), excluding managed
   *  bio links — the same exclusion the per-workspace top-links uses. */
  topLinks(start: string, end: string, limit: number): Promise<RankRow[]>;
  /** A platform-wide breakdown for one dimension, value-descending, UNLIMITED
   *  (the service slices). */
  breakdown(dimension: string, start: string, end: string): Promise<RankRow[]>;

  /* ── per-workspace decomposition (the totals==sum check reads this) ── */
  /** Clicks and uniques grouped by workspace over the window. The platform
   *  totals are the column sums of this, by construction. */
  clicksByWorkspace(start: string, end: string): Promise<Array<{ workspaceId: string; clicks: number; unique: number }>>;

  /* ── business ── */
  workspacesByPlan(): Promise<RankRow[]>;
  /** Every workspace's clicks in the window with its plan and included
   *  allowance, so the service can pick the ones near their limit. */
  workspaceUsage(start: string, end: string): Promise<WorkspaceUsageRow[]>;

  /* ── abuse ── */
  reportsFiled(start: string, end: string): Promise<number>;
  reportsByWeek(start: string, end: string): Promise<Array<{ label: string; value: number }>>;
  /** Reports whose last update falls in the window and are no longer "open",
   *  with the mean hours from creation to that update. */
  resolvedReports(start: string, end: string): Promise<{ resolved: number; avgResolutionHours: number | null }>;
}

export class PostgresAdminAnalyticsReader implements AdminAnalyticsReader {
  // Read-only handle: every query is a pure aggregation with no write, so the
  // module constructs this off READ_DB (the replica), exactly like
  // PostgresAnalyticsReader.
  constructor(private readonly db: Database) {}

  // ── growth ──────────────────────────────────────────────

  async signups(start: string, end: string): Promise<number> {
    const [row] = await this.db
      .select({ n: sql<number>`count(*)::int` })
      .from(users)
      .where(and(gte(users.createdAt, new Date(start)), lt(users.createdAt, new Date(end))));
    return row?.n ?? 0;
  }

  async signupsByDay(start: string, end: string): Promise<DayPoint[]> {
    const day = sql<string>`to_char(date_trunc('day', ${users.createdAt} at time zone 'UTC'), 'YYYY-MM-DD')`;
    const rows = await this.db
      .select({ date: day, value: sql<number>`count(*)::int` })
      .from(users)
      .where(and(gte(users.createdAt, new Date(start)), lt(users.createdAt, new Date(end))))
      .groupBy(day)
      .orderBy(day);
    return rows as DayPoint[];
  }

  async newWorkspaces(start: string, end: string): Promise<number> {
    const [row] = await this.db
      .select({ n: sql<number>`count(*)::int` })
      .from(workspaces)
      .where(and(gte(workspaces.createdAt, new Date(start)), lt(workspaces.createdAt, new Date(end))));
    return row?.n ?? 0;
  }

  async activeUsers(start: string, end: string): Promise<number> {
    // Distinct users with membership activity in the window. memberships.userId
    // is nullable (invitations exist before the user does), so count only rows
    // that resolved to a user.
    const [row] = await this.db
      .select({ n: sql<number>`count(distinct ${memberships.userId})::int` })
      .from(memberships)
      .where(
        and(
          sql`${memberships.userId} is not null`,
          gte(memberships.lastActiveAt, new Date(start)),
          lt(memberships.lastActiveAt, new Date(end)),
        ),
      );
    return row?.n ?? 0;
  }

  async retentionAfterWeeks(start: string, end: string, weeks: number): Promise<{ retained: number; cohort: number }> {
    // Cohort: users who signed up in the window. Retained: those of them whose
    // account was still active (users.last_active_at) at least `weeks` after
    // their OWN signup day. A per-user offset, so it is expressed against
    // users.createdAt rather than a single window-wide date.
    const [row] = await this.db
      .select({
        cohort: sql<number>`count(*)::int`,
        retained: sql<number>`count(*) filter (
          where ${users.lastActiveAt} is not null
            and ${users.lastActiveAt} >= ${users.createdAt} + (${weeks} * interval '7 days')
        )::int`,
      })
      .from(users)
      .where(and(gte(users.createdAt, new Date(start)), lt(users.createdAt, new Date(end))));
    return { retained: row?.retained ?? 0, cohort: row?.cohort ?? 0 };
  }

  // ── usage ───────────────────────────────────────────────

  async linksCreated(start: string, end: string): Promise<number> {
    const [row] = await this.db
      .select({ n: sql<number>`count(*)::int` })
      .from(links)
      .where(and(gte(links.createdAt, new Date(start)), lt(links.createdAt, new Date(end))));
    return row?.n ?? 0;
  }

  async clickTotals(start: string, end: string): Promise<{ clicks: number; unique: number }> {
    const [row] = await this.db
      .select({
        clicks: sql<number>`coalesce(sum(${clickDaily.clicks}), 0)::int`,
        unique: sql<number>`coalesce(sum(${clickDaily.uniques}), 0)::int`,
      })
      .from(clickDaily)
      .where(and(gte(clickDaily.day, start), lt(clickDaily.day, end)));
    return { clicks: row?.clicks ?? 0, unique: row?.unique ?? 0 };
  }

  async clicksByDay(start: string, end: string): Promise<DayPoint[]> {
    const rows = await this.db
      .select({ date: clickDaily.day, value: sql<number>`coalesce(sum(${clickDaily.clicks}), 0)::int` })
      .from(clickDaily)
      .where(and(gte(clickDaily.day, start), lt(clickDaily.day, end)))
      .groupBy(clickDaily.day)
      .orderBy(clickDaily.day);
    return rows as DayPoint[];
  }

  async topWorkspaces(start: string, end: string, limit: number): Promise<RankRow[]> {
    const rows = await this.db
      .select({ label: workspaces.name, value: sql<number>`sum(${clickDaily.clicks})::int` })
      .from(clickDaily)
      .innerJoin(workspaces, sql`${workspaces.id} = ${clickDaily.workspaceId}`)
      .where(and(gte(clickDaily.day, start), lt(clickDaily.day, end)))
      .groupBy(workspaces.id, workspaces.name)
      .orderBy(desc(sql`sum(${clickDaily.clicks})`))
      .limit(limit);
    return rows.map((r) => ({ label: r.label, value: r.value }));
  }

  async topLinks(start: string, end: string, limit: number): Promise<RankRow[]> {
    const rows = await this.db
      .select({ label: links.slug, value: sql<number>`sum(${clickDaily.clicks})::int` })
      .from(clickDaily)
      .innerJoin(links, sql`${links.id} = ${clickDaily.linkId}`)
      // #650: managed bio links are infrastructure, not user links — excluded
      // from "top links" everywhere they are surfaced.
      .where(and(gte(clickDaily.day, start), lt(clickDaily.day, end), sql`${links.managedBioPageId} is null`))
      .groupBy(links.slug)
      .orderBy(desc(sql`sum(${clickDaily.clicks})`))
      .limit(limit);
    return rows.map((r) => ({ label: r.label, value: r.value }));
  }

  async breakdown(dimension: string, start: string, end: string): Promise<RankRow[]> {
    const rows = await this.db
      .select({ label: breakdownDaily.value, value: sql<number>`sum(${breakdownDaily.count})::int` })
      .from(breakdownDaily)
      .where(
        and(sql`${breakdownDaily.dimension} = ${dimension}`, gte(breakdownDaily.day, start), lt(breakdownDaily.day, end)),
      )
      .groupBy(breakdownDaily.value)
      .orderBy(desc(sql`sum(${breakdownDaily.count})`));
    return rows.map((r) => ({ label: r.label, value: r.value }));
  }

  async clicksByWorkspace(
    start: string,
    end: string,
  ): Promise<Array<{ workspaceId: string; clicks: number; unique: number }>> {
    const rows = await this.db
      .select({
        workspaceId: clickDaily.workspaceId,
        clicks: sql<number>`coalesce(sum(${clickDaily.clicks}), 0)::int`,
        unique: sql<number>`coalesce(sum(${clickDaily.uniques}), 0)::int`,
      })
      .from(clickDaily)
      .where(and(gte(clickDaily.day, start), lt(clickDaily.day, end)))
      .groupBy(clickDaily.workspaceId);
    return rows as Array<{ workspaceId: string; clicks: number; unique: number }>;
  }

  // ── business ────────────────────────────────────────────

  async workspacesByPlan(): Promise<RankRow[]> {
    const rows = await this.db
      .select({ label: workspaces.plan, value: sql<number>`count(*)::int` })
      .from(workspaces)
      .groupBy(workspaces.plan)
      .orderBy(desc(sql`count(*)`));
    return rows.map((r) => ({ label: r.label, value: r.value }));
  }

  async workspaceUsage(start: string, end: string): Promise<WorkspaceUsageRow[]> {
    // Left join so a workspace with no clicks in the window still appears with
    // 0 — a workspace near a tiny allowance matters even at low volume, and the
    // service decides what "near" means.
    const rows = await this.db
      .select({
        workspace: workspaces.name,
        plan: workspaces.plan,
        included: workspaces.clicksIncluded,
        clicks: sql<number>`coalesce(sum(${clickDaily.clicks}) filter (
          where ${clickDaily.day} >= ${start} and ${clickDaily.day} < ${end}
        ), 0)::int`,
      })
      .from(workspaces)
      .leftJoin(clickDaily, sql`${clickDaily.workspaceId} = ${workspaces.id}`)
      .groupBy(workspaces.id, workspaces.name, workspaces.plan, workspaces.clicksIncluded);
    return rows as WorkspaceUsageRow[];
  }

  // ── abuse ───────────────────────────────────────────────

  async reportsFiled(start: string, end: string): Promise<number> {
    const [row] = await this.db
      .select({ n: sql<number>`count(*)::int` })
      .from(abuseReports)
      .where(and(gte(abuseReports.createdAt, new Date(start)), lt(abuseReports.createdAt, new Date(end))));
    return row?.n ?? 0;
  }

  async reportsByWeek(start: string, end: string): Promise<Array<{ label: string; value: number }>> {
    // ISO week label YYYY-Www (IYYY/IW), so weeks sort lexically in order.
    const week = sql<string>`to_char(date_trunc('week', ${abuseReports.createdAt} at time zone 'UTC'), 'IYYY"-W"IW')`;
    const rows = await this.db
      .select({ label: week, value: sql<number>`count(*)::int` })
      .from(abuseReports)
      .where(and(gte(abuseReports.createdAt, new Date(start)), lt(abuseReports.createdAt, new Date(end))))
      .groupBy(week)
      .orderBy(week);
    return rows as Array<{ label: string; value: number }>;
  }

  async resolvedReports(start: string, end: string): Promise<{ resolved: number; avgResolutionHours: number | null }> {
    // A report counts as resolved in the window when it is no longer "open" and
    // its last update (updated_at) landed inside the window. Resolution time is
    // updated_at - created_at in hours.
    const [row] = await this.db
      .select({
        resolved: sql<number>`count(*)::int`,
        avgHours: sql<number | null>`avg(extract(epoch from (${abuseReports.updatedAt} - ${abuseReports.createdAt})) / 3600.0)`,
      })
      .from(abuseReports)
      .where(
        and(
          sql`${abuseReports.status} <> 'open'`,
          gte(abuseReports.updatedAt, new Date(start)),
          lt(abuseReports.updatedAt, new Date(end)),
        ),
      );
    const resolved = row?.resolved ?? 0;
    // avg() returns a numeric string from pg; coerce and round to 2 dp.
    const avg = row?.avgHours == null ? null : Math.round(Number(row.avgHours) * 100) / 100;
    return { resolved, avgResolutionHours: resolved === 0 ? null : avg };
  }
}
