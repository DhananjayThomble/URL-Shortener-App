import { Inject, Injectable } from "@nestjs/common";
import type { Analytics, AnalyticsQuery, Breakdown, TimeseriesPoint } from "@snapurl/contract";
import { ANALYTICS_READER, type AnalyticsReader } from "./analytics.reader.js";

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
  constructor(
    // The analytics READ path lives behind AnalyticsReader (see
    // analytics.reader.ts). The Postgres adapter reads the rollup tables off
    // the read replica; this service never touches Drizzle. All the
    // store-agnostic logic — the city floor, country-name/flag mapping, top-N
    // slice, period math, deltas, and the zero-filled series — stays here, so
    // swapping the store for ClickHouse or Timescale changes no numbers.
    @Inject(ANALYTICS_READER) private readonly reader: AnalyticsReader,
  ) {}

  /* Everything here reads rollup tables, never click_events.

     Aggregating raw rows on page load is fine at a thousand clicks and
     unusable at ten million; the rollups exist precisely so this endpoint's
     cost is bounded by the date range rather than by traffic.

     Replica-safe: the reader only reads rollup tables and never writes, so it
     is constructed off the read replica. No read-then-write here, so replica
     lag cannot produce a wrong answer relative to a write in the same
     operation. */
  async overview(workspaceId: string, query: AnalyticsQuery): Promise<Analytics> {
    const days = RANGE_DAYS[query.range] ?? 30;
    const { start, previousStart } = windowFor(days);

    const [current, previous, series] = await Promise.all([
      this.reader.totals(workspaceId, query.linkId, start),
      this.reader.previousTotals(workspaceId, query.linkId, previousStart, start),
      this.reader.series(workspaceId, query.linkId, start),
    ]);

    const [countries, cityRows, devices, browsers, referrers] = await Promise.all([
      this.reader.breakdown(workspaceId, "country", start, query.linkId),
      /* Unlimited, because the k-anonymity floor has to see the whole tail to
         fold it — taking the top 8 first would discard the small cities rather
         than aggregate them, and the total would stop adding up. The reader
         returns every city; applyCityFloor does the folding and the trim. */
      this.reader.breakdown(workspaceId, "city", start, query.linkId),
      this.reader.breakdown(workspaceId, "device", start, query.linkId),
      this.reader.breakdown(workspaceId, "browser", start, query.linkId),
      this.reader.breakdown(workspaceId, "referrer", start, query.linkId),
    ]);

    const [tags, topLinks] = await Promise.all([
      this.reader.tagBreakdown(workspaceId, start),
      this.reader.topLinks(workspaceId, start),
    ]);

    /* Conversions live in their own table rather than the click rollups, so
       the stat tile needs its own count. Without this the analytics page reads
       zero while the conversions page reports hundreds — the kind of
       contradiction that makes someone stop trusting both numbers. */
    const [conversionCount, previousConversions] = await Promise.all([
      this.reader.conversionTotals(workspaceId, query.linkId, start),
      this.reader.previousConversionTotals(workspaceId, query.linkId, previousStart, start),
    ]);

    const cities = applyCityFloor(cityRows);

    return {
      totals: {
        clicks: current.clicks,
        unique: current.unique,
        scans: current.scans,
        conversions: conversionCount,
        blocked: current.blocked,
      },
      deltas: {
        clicks: percentChange(previous.clicks, current.clicks),
        unique: percentChange(previous.unique, current.unique),
        scans: percentChange(previous.scans, current.scans),
        conversions: percentChange(previousConversions, conversionCount),
      },
      series: fillSeries(series as TimeseriesPoint[], start, days),
      countries: topN(countries).map((c) => ({
        label: COUNTRY_NAMES[c.label] ?? c.label,
        value: c.value,
        icon: FLAGS[c.label] ?? "🌐",
      })),
      cities,
      /* Top 8 for the other dimensions. The reader returns the full,
         value-descending tail (unlimited), so the slice — like the city floor —
         is store-agnostic logic that stays here. */
      devices: topN(devices),
      browsers: topN(browsers),
      referrers: topN(referrers),
      tags,
      topLinks,
    };
  }
}

/** The top-N slice applied to the non-city breakdowns. The reader returns rows
 *  ordered by value descending and UNLIMITED; taking 8 here (rather than in the
 *  adapter) keeps the slice identical across any store. */
function topN(rows: Breakdown[], limit = 8): Breakdown[] {
  return rows.slice(0, limit);
}

/**
 * The smallest number of clicks a city may be named for.
 *
 * Country plus device plus browser identifies nobody. City plus device plus
 * browser plus OS plus referrer, somewhere small enough, can. Five is a
 * judgement, not a standard — raise it here and everywhere follows.
 */
export const CITY_MIN_CLICKS = 5;

/** What the folded remainder is called. */
export const OTHER_CITIES = "Other cities";

/**
 * Fold thinly-populated cities into one bucket.
 *
 * The total is preserved, so the workspace loses no volume — it loses only the
 * ability to read "one visitor, this city" off the dashboard beside a single
 * device and a single referrer. See docs/DECISIONS.md.
 *
 * "Unknown" is passed through whatever its size: it is already an aggregate of
 * every click CloudFront could not place, so it identifies no one, and folding
 * it into "Other cities" would lose the distinction between "we don't know"
 * and "too few to say".
 */
export function applyCityFloor(rows: Breakdown[], min = CITY_MIN_CLICKS, limit = 8): Breakdown[] {
  const named: Breakdown[] = [];
  let folded = 0;

  for (const row of rows) {
    if (row.label === "Unknown" || row.value >= min) named.push(row);
    else folded += row.value;
  }

  named.sort((a, b) => b.value - a.value);
  // Trim before adding the bucket, so the bucket cannot itself be trimmed away
  // and take the tail's volume with it.
  const top = named.slice(0, limit);
  for (const row of named.slice(limit)) folded += row.value;

  return folded > 0 ? [...top, { label: OTHER_CITIES, value: folded }] : top;
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
