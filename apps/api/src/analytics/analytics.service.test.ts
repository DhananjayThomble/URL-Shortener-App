import { describe, expect, it } from "vitest";
import type { AnalyticsQuery } from "@snapurl/contract";
import type { AnalyticsReader, BreakdownRow, PreviousTotals, SeriesPoint, Totals } from "./analytics.reader.js";
import { AnalyticsService, CITY_MIN_CLICKS, OTHER_CITIES, applyCityFloor, fillSeries, iso, percentChange, windowFor } from "./analytics.service.js";

/* The three pure helpers behind every number on the analytics screen. Each has
   a failure mode that renders as a plausible-looking chart rather than an
   error, which is why they are worth pinning. */

describe("windowFor", () => {
  it("makes the window inclusive of today", () => {
    // 30 days means today plus the 29 before it. Off by one here shifts every
    // total silently.
    const { start } = windowFor(30);
    const today = new Date();
    today.setUTCHours(0, 0, 0, 0);
    const spanDays = Math.round((today.getTime() - start.getTime()) / 864e5);
    expect(spanDays).toBe(29);
  });

  it("puts the previous window immediately before, and the same length", () => {
    // The deltas compare like with like only if the two windows abut.
    const { start, previousStart } = windowFor(7);
    expect(Math.round((start.getTime() - previousStart.getTime()) / 864e5)).toBe(7);
  });

  it("starts both windows at midnight UTC", () => {
    // The rollups are keyed on a UTC date. A window starting mid-day would
    // include part of a day the rollup counts whole.
    const { start, previousStart } = windowFor(30);
    for (const d of [start, previousStart]) {
      expect([d.getUTCHours(), d.getUTCMinutes(), d.getUTCSeconds(), d.getUTCMilliseconds()]).toEqual([0, 0, 0, 0]);
    }
  });

  it("handles a single-day window", () => {
    const { start, previousStart } = windowFor(1);
    expect(Math.round((start.getTime() - previousStart.getTime()) / 864e5)).toBe(1);
  });
});

describe("percentChange", () => {
  it("reports growth from zero as +100%, not infinity", () => {
    // The zero baseline is the case that would otherwise render "Infinity%"
    // on a brand-new workspace's first day.
    expect(percentChange(0, 500)).toBe(100);
  });

  it("reports no change from zero as 0%", () => {
    expect(percentChange(0, 0)).toBe(0);
  });

  it("computes ordinary growth and decline", () => {
    expect(percentChange(100, 150)).toBe(50);
    expect(percentChange(100, 50)).toBe(-50);
    expect(percentChange(100, 100)).toBe(0);
  });

  it("reports a drop to zero as -100%", () => {
    expect(percentChange(80, 0)).toBe(-100);
  });

  it("rounds to one decimal place", () => {
    expect(percentChange(3, 4)).toBe(33.3);
    expect(percentChange(7, 9)).toBe(28.6);
  });

  it("does not lose small changes on a large baseline", () => {
    expect(percentChange(1_000_000, 1_001_000)).toBe(0.1);
  });
});

describe("fillSeries", () => {
  const start = new Date("2026-03-01T00:00:00.000Z");

  it("returns exactly one point per day in the window", () => {
    expect(fillSeries([], start, 30)).toHaveLength(30);
    expect(fillSeries([], start, 7)).toHaveLength(7);
  });

  it("zero-fills a day with no data rather than omitting it", () => {
    // An omitted day is drawn as a straight line between two distant points,
    // which reads as steady traffic across a gap that had none.
    const filled = fillSeries([], start, 3);
    expect(filled).toEqual([
      { date: "2026-03-01", clicks: 0, unique: 0, scans: 0 },
      { date: "2026-03-02", clicks: 0, unique: 0, scans: 0 },
      { date: "2026-03-03", clicks: 0, unique: 0, scans: 0 },
    ]);
  });

  it("keeps the rows it was given, in date order", () => {
    const filled = fillSeries(
      [
        { date: "2026-03-03", clicks: 9, unique: 7, scans: 1 },
        { date: "2026-03-01", clicks: 4, unique: 3, scans: 0 },
      ],
      start,
      3,
    );
    expect(filled.map((p) => p.date)).toEqual(["2026-03-01", "2026-03-02", "2026-03-03"]);
    expect(filled[0]).toMatchObject({ clicks: 4, unique: 3 });
    expect(filled[1]).toMatchObject({ clicks: 0, unique: 0 });
    expect(filled[2]).toMatchObject({ clicks: 9, unique: 7 });
  });

  it("ignores rows outside the window", () => {
    // A stray row from before the window must not displace a real day.
    const filled = fillSeries([{ date: "2026-02-25", clicks: 99, unique: 99, scans: 0 }], start, 2);
    expect(filled).toHaveLength(2);
    expect(filled.every((p) => p.clicks === 0)).toBe(true);
  });

  it("advances dates across a month boundary", () => {
    const filled = fillSeries([], new Date("2026-03-30T00:00:00.000Z"), 3);
    expect(filled.map((p) => p.date)).toEqual(["2026-03-30", "2026-03-31", "2026-04-01"]);
  });

  it("advances dates across a leap day", () => {
    const filled = fillSeries([], new Date("2028-02-28T00:00:00.000Z"), 3);
    expect(filled.map((p) => p.date)).toEqual(["2028-02-28", "2028-02-29", "2028-03-01"]);
  });
});

describe("iso", () => {
  it("formats a date as the YYYY-MM-DD key the rollups are keyed on", () => {
    expect(iso(new Date("2026-03-01T13:45:00.000Z"))).toBe("2026-03-01");
  });
});

describe("applyCityFloor", () => {
  const total = (rows: Array<{ value: number }>) => rows.reduce((n, r) => n + r.value, 0);

  it("names a city that clears the threshold", () => {
    const out = applyCityFloor([{ label: "Pune", value: CITY_MIN_CLICKS }]);
    expect(out).toEqual([{ label: "Pune", value: CITY_MIN_CLICKS }]);
  });

  it("folds a city one click short of the threshold", () => {
    // The whole point: "Pune · 1 click" beside one iPhone and one referrer is
    // a person, not a statistic.
    const out = applyCityFloor([{ label: "Pune", value: CITY_MIN_CLICKS - 1 }]);
    expect(out).toEqual([{ label: OTHER_CITIES, value: CITY_MIN_CLICKS - 1 }]);
  });

  it("keeps the total intact when it folds", () => {
    const rows = [
      { label: "Mumbai", value: 40 },
      { label: "Pune", value: 3 },
      { label: "Nashik", value: 2 },
      { label: "Satara", value: 1 },
    ];
    const out = applyCityFloor(rows);
    expect(total(out)).toBe(total(rows));
    expect(out).toEqual([
      { label: "Mumbai", value: 40 },
      { label: OTHER_CITIES, value: 6 },
    ]);
  });

  it("passes Unknown through however small it is", () => {
    // Unknown is already an aggregate of every click CloudFront could not
    // place, so it identifies nobody — and folding it would lose the
    // difference between "we don't know" and "too few to say".
    const out = applyCityFloor([{ label: "Unknown", value: 1 }, { label: "Pune", value: 1 }]);
    expect(out).toEqual([
      { label: "Unknown", value: 1 },
      { label: OTHER_CITIES, value: 1 },
    ]);
  });

  it("adds no bucket when nothing was folded", () => {
    const out = applyCityFloor([{ label: "Mumbai", value: 9 }]);
    expect(out.some((r) => r.label === OTHER_CITIES)).toBe(false);
  });

  it("rolls the trimmed tail into the bucket rather than dropping it", () => {
    // Trimming to the top N *after* folding would silently lose volume, and
    // the dashboard totals would stop agreeing with the click count.
    const rows = Array.from({ length: 12 }, (_, i) => ({ label: `City${i}`, value: 100 - i }));
    const out = applyCityFloor(rows, CITY_MIN_CLICKS, 8);
    expect(out).toHaveLength(9);
    expect(out[8]!.label).toBe(OTHER_CITIES);
    expect(total(out)).toBe(total(rows));
  });

  it("returns the strongest cities first", () => {
    const out = applyCityFloor([
      { label: "Small", value: 6 },
      { label: "Big", value: 60 },
    ]);
    expect(out.map((r) => r.label)).toEqual(["Big", "Small"]);
  });

  it("handles an empty window", () => {
    expect(applyCityFloor([])).toEqual([]);
  });
});

/* The service reads through the AnalyticsReader port (analytics.reader.ts) and
   never touches Drizzle. A fake reader lets us prove overview() still applies
   all the store-agnostic logic — the city floor, country-name/flag mapping, the
   top-8 slice, the period deltas, the zero-filled series, and the conversion
   totals — against canned rows, which is exactly what the port decouples from
   the store. If the service stopped folding, mapping, slicing, or computing
   deltas, this test fails. */
describe("AnalyticsService.overview through a fake reader", () => {
  /** A reader that returns whatever canned rows the test hands it. */
  class FakeReader implements AnalyticsReader {
    constructor(
      private readonly data: {
        totals: Totals;
        previousTotals: PreviousTotals;
        series: SeriesPoint[];
        breakdowns: Record<string, BreakdownRow[]>;
        tagBreakdown: BreakdownRow[];
        topLinks: BreakdownRow[];
        conversionTotals: number;
        previousConversionTotals: number;
      },
    ) {}

    async totals(): Promise<Totals> {
      return this.data.totals;
    }
    async previousTotals(): Promise<PreviousTotals> {
      return this.data.previousTotals;
    }
    async series(): Promise<SeriesPoint[]> {
      return this.data.series;
    }
    async breakdown(_workspaceId: string, dimension: string): Promise<BreakdownRow[]> {
      return this.data.breakdowns[dimension] ?? [];
    }
    async tagBreakdown(): Promise<BreakdownRow[]> {
      return this.data.tagBreakdown;
    }
    async topLinks(): Promise<BreakdownRow[]> {
      return this.data.topLinks;
    }
    async conversionTotals(): Promise<number> {
      return this.data.conversionTotals;
    }
    async previousConversionTotals(): Promise<number> {
      return this.data.previousConversionTotals;
    }
  }

  const query: AnalyticsQuery = { range: "30d" } as AnalyticsQuery;

  function build(overrides: Partial<ConstructorParameters<typeof FakeReader>[0]> = {}) {
    const reader = new FakeReader({
      totals: { clicks: 200, unique: 150, scans: 20, blocked: 3 },
      previousTotals: { clicks: 100, unique: 75, scans: 10 },
      series: [],
      breakdowns: {
        country: [
          { label: "IN", value: 120 },
          { label: "US", value: 60 },
          { label: "ZZ", value: 20 },
        ],
        city: [
          { label: "Mumbai", value: 40 },
          { label: "Pune", value: 3 },
          { label: "Nashik", value: 2 },
          { label: "Unknown", value: 1 },
        ],
        device: [],
        browser: [],
        referrer: [],
      },
      tagBreakdown: [{ label: "launch", value: 12 }],
      topLinks: [{ label: "promo", value: 90 }],
      conversionTotals: 30,
      previousConversionTotals: 15,
      ...overrides,
    });
    return new AnalyticsService(reader);
  }

  it("assembles totals and deltas from the reader's current/previous windows", async () => {
    const out = await build().overview("ws_1", query);
    expect(out.totals).toEqual({ clicks: 200, unique: 150, scans: 20, conversions: 30, blocked: 3 });
    // Deltas use percentChange against the previous window and the conversion totals.
    expect(out.deltas).toEqual({
      clicks: percentChange(100, 200),
      unique: percentChange(75, 150),
      scans: percentChange(10, 20),
      conversions: percentChange(15, 30),
    });
  });

  it("maps country codes to names and flags, unknown codes to a globe", async () => {
    const out = await build().overview("ws_1", query);
    expect(out.countries).toEqual([
      { label: "India", value: 120, icon: "🇮🇳" },
      { label: "United States", value: 60, icon: "🇺🇸" },
      { label: "ZZ", value: 20, icon: "🌐" },
    ]);
  });

  it("applies the city floor over the whole tail the reader returns", async () => {
    const out = await build().overview("ws_1", query);
    // Pune (3) and Nashik (2) fall under the floor and fold; Unknown passes
    // through; Mumbai is named. Total volume is preserved.
    expect(out.cities).toEqual([
      { label: "Mumbai", value: 40 },
      { label: "Unknown", value: 1 },
      { label: OTHER_CITIES, value: 5 },
    ]);
  });

  it("slices non-city breakdowns to the top 8", async () => {
    const devices = Array.from({ length: 12 }, (_, i) => ({ label: `d${i}`, value: 100 - i }));
    const out = await build({ breakdowns: { country: [], city: [], device: devices, browser: [], referrer: [] } }).overview("ws_1", query);
    expect(out.devices).toHaveLength(8);
    expect(out.devices.map((d) => d.label)).toEqual(["d0", "d1", "d2", "d3", "d4", "d5", "d6", "d7"]);
  });

  it("zero-fills the series via fillSeries for the whole window", async () => {
    const out = await build().overview("ws_1", query);
    expect(out.series).toHaveLength(30);
    expect(out.series.every((p) => p.clicks === 0 && p.unique === 0 && p.scans === 0)).toBe(true);
  });

  it("passes tags and top links through from the reader", async () => {
    const out = await build().overview("ws_1", query);
    expect(out.tags).toEqual([{ label: "launch", value: 12 }]);
    expect(out.topLinks).toEqual([{ label: "promo", value: 90 }]);
  });
});
