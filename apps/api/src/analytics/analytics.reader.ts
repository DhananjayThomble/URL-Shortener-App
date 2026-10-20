import { and, breakdownDaily, clickDaily, clickEvents, conversions, desc, eq, gte, isNull, links, lt, sql, type Database } from "@snapurl/database";
import { iso } from "./analytics.service.js";

/* ============================================================
   The analytics READ path, behind a port.

   Everything the dashboard asks for — totals with a period
   comparison, the daily series, breakdowns by dimension, tag
   rollups, top links, and the conversion totals the overview
   tile shows — comes through this interface. The Postgres
   adapter below reads the rollup tables (click_daily,
   breakdown_daily, conversions, links) directly, which is what
   keeps the whole product runnable on one database with no
   extra infrastructure.

   This is the documented seam for a future columnar store. Every
   analytics product at this scale ends up there — Plausible and
   PostHog on ClickHouse, Dub via Tinybird — and retrofitting the
   seam later means touching every query a second time, which is
   the pass that quietly introduces differences between what two
   stores return. So the seam exists now; the columnar adapter
   does not (see the note at the bottom of this file).

   Any adapter MUST return the same row shapes the Postgres one
   does. The service maps those rows into @snapurl/contract types
   (Analytics, Breakdown, TimeseriesPoint), applies the
   store-agnostic logic — the k-anonymity city floor, the
   country-name/flag mapping, the top-N slice, the period math and
   deltas, the zero-filled series — and assembles the response. If
   an adapter returned a different shape, two dashboards backed by
   two stores could disagree and nobody would know which was right.
   ============================================================ */

/** Raw totals for a window, straight off the click rollup. Coalesced to 0 so
 *  an empty window is a real zero rather than null. */
export interface Totals {
  clicks: number;
  unique: number;
  scans: number;
  blocked: number;
}

/** The previous window needs no `blocked` — only the four headline metrics get
 *  a period delta. */
export interface PreviousTotals {
  clicks: number;
  unique: number;
  scans: number;
}

/** One day of the series, keyed on the same YYYY-MM-DD the rollup is keyed on.
 *  The service zero-fills the gaps; the adapter returns only the days present. */
export interface SeriesPoint {
  date: string;
  clicks: number;
  unique: number;
  scans: number;
}

/** A raw (label, value) pair from a breakdown query. Unmapped and, for
 *  breakdown(), UNLIMITED — the service applies the top-N slice, the city
 *  floor, and the country-name/flag mapping, exactly as it did when these
 *  queries lived inline. */
export interface BreakdownRow {
  label: string;
  value: number;
}

export interface AnalyticsReader {
  /** Headline totals for the current window. */
  totals(workspaceId: string, scopeLinkId: string | undefined, start: Date): Promise<Totals>;
  /** The same totals for the immediately-preceding window, for deltas. */
  previousTotals(
    workspaceId: string,
    scopeLinkId: string | undefined,
    previousStart: Date,
    start: Date,
  ): Promise<PreviousTotals>;
  /** The daily series for the current window, only the days that have rows. */
  series(workspaceId: string, scopeLinkId: string | undefined, start: Date): Promise<SeriesPoint[]>;
  /**
   * The HOURLY series for a 24h window (#770), read straight off click_events
   * rather than the daily rollup — the rollup has no sub-day resolution, so the
   * old 24h path drew a single point.
   *
   * `start` is the lower bound (exclusive-of-nothing: `occurred_at >= start`);
   * the service passes `now - 24h`. The query is bounded to that window, which
   * click_events' RANGE partitioning by occurred_at prunes to the one or two
   * day-partitions the window spans, and `click_events_{link,workspace}_time_idx`
   * serve the scan — so this stays cheap and never fans out across partitions.
   *
   * `date` is a `YYYY-MM-DDTHH:00` UTC hour. Only the hours that have rows are
   * returned; the service zero-fills the 24 buckets. The counting rules match
   * the rollup exactly (rollup.ts): clicks and scans exclude bots and blocked
   * clicks, scans additionally require is_qr, and `unique` is a true distinct
   * visitor_hash over the hour (an exact count is fine and bounded here — the
   * HLL sketch exists only to keep the persisted daily rollup small).
   */
  hourlySeries(workspaceId: string, scopeLinkId: string | undefined, start: Date): Promise<SeriesPoint[]>;
  /* breakdown() returns rows ordered by value descending, UNLIMITED. The
     service takes the top 8 for country/device/browser/referrer and passes the
     full tail through applyCityFloor for city — so slicing lives in the
     service, not here, and both stores return the same unbounded rows. */
  breakdown(workspaceId: string, dimension: string, start: Date, linkId?: string): Promise<BreakdownRow[]>;
  /** Clicks grouped by the link's current tags (top 8). */
  tagBreakdown(workspaceId: string, start: Date): Promise<BreakdownRow[]>;
  /** The busiest links by clicks in the window (top 8), labelled by slug. */
  topLinks(workspaceId: string, start: Date): Promise<BreakdownRow[]>;
  /** Conversion count for the current window. */
  conversionTotals(workspaceId: string, scopeLinkId: string | undefined, start: Date): Promise<number>;
  /** Conversion count for the preceding window, for the delta. */
  previousConversionTotals(
    workspaceId: string,
    scopeLinkId: string | undefined,
    previousStart: Date,
    start: Date,
  ): Promise<number>;
}

/** The DI token the module binds to PostgresAnalyticsReader off the READ_DB
 *  replica handle. Mirrors the Symbol-token pattern in database.module.ts. */
export const ANALYTICS_READER = Symbol("ANALYTICS_READER");

export class PostgresAnalyticsReader implements AnalyticsReader {
  // Read-only handle. Every query here is a pure dashboard aggregation over
  // rollup tables with no write in the same operation, so all of them are
  // replica-safe — the service constructs this off READ_DB.
  constructor(private readonly db: Database) {}

  /** The scope predicate: a single link when linkId is set, else the whole
   *  workspace. Kept identical to the branch that lived in overview(). */
  private scopeFor(workspaceId: string, scopeLinkId: string | undefined) {
    return scopeLinkId ? and(eq(clickDaily.workspaceId, workspaceId), eq(clickDaily.linkId, scopeLinkId)) : eq(clickDaily.workspaceId, workspaceId);
  }

  async totals(workspaceId: string, scopeLinkId: string | undefined, start: Date): Promise<Totals> {
    const scope = this.scopeFor(workspaceId, scopeLinkId);
    const [current] = await this.db
      .select({
        clicks: sql<number>`coalesce(sum(${clickDaily.clicks}), 0)::int`,
        unique: sql<number>`coalesce(sum(${clickDaily.uniques}), 0)::int`,
        scans: sql<number>`coalesce(sum(${clickDaily.scans}), 0)::int`,
        blocked: sql<number>`coalesce(sum(${clickDaily.blocked}), 0)::int`,
      })
      .from(clickDaily)
      .where(and(scope, gte(clickDaily.day, iso(start))));

    return {
      clicks: current?.clicks ?? 0,
      unique: current?.unique ?? 0,
      scans: current?.scans ?? 0,
      blocked: current?.blocked ?? 0,
    };
  }

  async previousTotals(
    workspaceId: string,
    scopeLinkId: string | undefined,
    previousStart: Date,
    start: Date,
  ): Promise<PreviousTotals> {
    const scope = this.scopeFor(workspaceId, scopeLinkId);
    const [previous] = await this.db
      .select({
        clicks: sql<number>`coalesce(sum(${clickDaily.clicks}), 0)::int`,
        unique: sql<number>`coalesce(sum(${clickDaily.uniques}), 0)::int`,
        scans: sql<number>`coalesce(sum(${clickDaily.scans}), 0)::int`,
      })
      .from(clickDaily)
      .where(and(scope, gte(clickDaily.day, iso(previousStart)), lt(clickDaily.day, iso(start))));

    return {
      clicks: previous?.clicks ?? 0,
      unique: previous?.unique ?? 0,
      scans: previous?.scans ?? 0,
    };
  }

  async series(workspaceId: string, scopeLinkId: string | undefined, start: Date): Promise<SeriesPoint[]> {
    const scope = this.scopeFor(workspaceId, scopeLinkId);
    const rows = await this.db
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
    return rows as SeriesPoint[];
  }

  /** The same scope predicate as scopeFor(), but on click_events — the hourly
   *  path reads the raw table, not the rollup. */
  private rawScopeFor(workspaceId: string, scopeLinkId: string | undefined) {
    return scopeLinkId
      ? and(eq(clickEvents.workspaceId, workspaceId), eq(clickEvents.linkId, scopeLinkId))
      : eq(clickEvents.workspaceId, workspaceId);
  }

  async hourlySeries(workspaceId: string, scopeLinkId: string | undefined, start: Date): Promise<SeriesPoint[]> {
    const scope = this.rawScopeFor(workspaceId, scopeLinkId);
    // date_trunc('hour', occurred_at AT TIME ZONE 'UTC') buckets by UTC hour,
    // matching the UTC day boundaries the rollups and partitions use. Rendered
    // as YYYY-MM-DDTHH:00 so the key is a stable, sortable hour string.
    const hour = sql<string>`to_char(date_trunc('hour', ${clickEvents.occurredAt} at time zone 'UTC'), 'YYYY-MM-DD"T"HH24:00')`;

    // Counting rules kept byte-for-byte in step with the daily rollup
    // (apps/worker/src/jobs/rollup.ts): bots and blocked clicks are excluded
    // from clicks and scans, scans additionally require is_qr, and uniques is a
    // distinct visitor_hash over the same filtered set.
    const live = sql`${clickEvents.isBot} = false and ${clickEvents.blockedReason} is null`;
    const rows = await this.db
      .select({
        date: hour,
        clicks: sql<number>`count(*) filter (where ${live})::int`,
        unique: sql<number>`count(distinct ${clickEvents.visitorHash}) filter (where ${live})::int`,
        scans: sql<number>`count(*) filter (where ${live} and ${clickEvents.isQr})::int`,
      })
      .from(clickEvents)
      // gte(occurred_at, start) is the whole window; the planner prunes to the
      // day-partition(s) it covers. No upper bound is needed — occurred_at is
      // never in the future — and omitting one keeps the predicate a single
      // range the index can serve.
      .where(and(scope, gte(clickEvents.occurredAt, start)))
      .groupBy(hour)
      .orderBy(hour);
    return rows as SeriesPoint[];
  }

  async breakdown(workspaceId: string, dimension: string, start: Date, linkId?: string): Promise<BreakdownRow[]> {
    const filters = [
      eq(breakdownDaily.workspaceId, workspaceId),
      eq(breakdownDaily.dimension, dimension),
      gte(breakdownDaily.day, iso(start)),
    ];
    if (linkId) filters.push(eq(breakdownDaily.linkId, linkId));

    // Replica-safe: pure read of the breakdown rollup.
    const rows = await this.db
      .select({ label: breakdownDaily.value, value: sql<number>`sum(${breakdownDaily.count})::int` })
      .from(breakdownDaily)
      .where(and(...filters))
      .groupBy(breakdownDaily.value)
      .orderBy(desc(sql`sum(${breakdownDaily.count})`));

    return rows.map((r) => ({ label: r.label, value: r.value }));
  }

  async tagBreakdown(workspaceId: string, start: Date): Promise<BreakdownRow[]> {
    // Replica-safe: pure read of the click rollup joined to links.
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

  async topLinks(workspaceId: string, start: Date): Promise<BreakdownRow[]> {
    // Replica-safe: pure read of the click rollup joined to links.
    const rows = await this.db
      .select({ slug: links.slug, value: sql<number>`sum(${clickDaily.clicks})::int` })
      .from(clickDaily)
      .innerJoin(links, eq(clickDaily.linkId, links.id))
      // #650: managed bio links are infrastructure, not user links — exclude
      // them from "top links" just as they are hidden from the links list.
      .where(and(eq(clickDaily.workspaceId, workspaceId), gte(clickDaily.day, iso(start)), isNull(links.managedBioPageId)))
      .groupBy(links.slug)
      .orderBy(desc(sql`sum(${clickDaily.clicks})`))
      .limit(8);
    return rows.map((r) => ({ label: r.slug, value: r.value }));
  }

  async conversionTotals(workspaceId: string, scopeLinkId: string | undefined, start: Date): Promise<number> {
    const [conversionTotals] = await this.db
      .select({ n: sql<number>`count(*)::int` })
      .from(conversions)
      .where(
        and(
          eq(conversions.workspaceId, workspaceId),
          gte(conversions.occurredAt, start),
          ...(scopeLinkId ? [eq(conversions.linkId, scopeLinkId)] : []),
        ),
      );
    return conversionTotals?.n ?? 0;
  }

  async previousConversionTotals(
    workspaceId: string,
    scopeLinkId: string | undefined,
    previousStart: Date,
    start: Date,
  ): Promise<number> {
    const [previousConversions] = await this.db
      .select({ n: sql<number>`count(*)::int` })
      .from(conversions)
      .where(
        and(
          eq(conversions.workspaceId, workspaceId),
          gte(conversions.occurredAt, previousStart),
          lt(conversions.occurredAt, start),
          ...(scopeLinkId ? [eq(conversions.linkId, scopeLinkId)] : []),
        ),
      );
    return previousConversions?.n ?? 0;
  }
}

/* The ClickHouse / Timescale adapter is deliberately not written yet.

   The seam above is the whole point of issue #284: an audit can point at this
   interface and say "fill this in" without a second pass over every query. A
   columnar adapter would implement AnalyticsReader over its own store and
   return the same row shapes, and nothing in AnalyticsService would change.

   Follow-up candidate for the same port: conversions.service.ts. Its
   report()/record() are a distinct dashboard read path (and a read-then-write
   on the primary), out of scope here — this reader covers only the conversion
   TOTALS that overview() reads. When that seam is added, the conversion counts
   above could move behind it too. */
