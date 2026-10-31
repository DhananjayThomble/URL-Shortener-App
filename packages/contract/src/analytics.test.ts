import { describe, expect, it } from "vitest";
import {
  Analytics,
  AnalyticsQuery,
  AnalyticsRange,
  Breakdown,
  ConversionEvent,
  ConversionsReport,
  CurrencyCode,
  ExcludedConversions,
  Granularity,
  RecordConversionInput,
  RecordConversionResult,
  TimeseriesPoint,
} from "./analytics.js";

/* #895: analytics is a read-mostly wire module with no runtime tests of its
   own. These pin the enum membership, the nested output shapes, the defaults
   that older clients rely on (granularity "day", currency "INR", excluded
   zero), and the two input schemas that carry real validation —
   AnalyticsQuery (#908: strict + linkId must be a uuid) and
   RecordConversionInput (G7 minor-units + uuid linkId). */

describe("Granularity / AnalyticsRange / ConversionEvent kind enums", () => {
  it("Granularity is day|hour", () => {
    expect(Granularity.safeParse("day").success).toBe(true);
    expect(Granularity.safeParse("hour").success).toBe(true);
    expect(Granularity.safeParse("minute").success).toBe(false);
  });
  it("AnalyticsRange is the five supported windows", () => {
    for (const r of ["24h", "7d", "30d", "90d", "12m"]) expect(AnalyticsRange.safeParse(r).success).toBe(true);
    expect(AnalyticsRange.safeParse("1y").success).toBe(false);
    expect(AnalyticsRange.safeParse("").success).toBe(false);
  });
});

describe("TimeseriesPoint and Breakdown shapes", () => {
  it("TimeseriesPoint requires date/clicks/unique, scans optional", () => {
    const parsed = TimeseriesPoint.parse({ date: "2026-01-01", clicks: 5, unique: 3 });
    expect(parsed.clicks).toBe(5);
    expect(TimeseriesPoint.safeParse({ date: "2026-01-01", clicks: 5 }).success).toBe(false); // no unique
    expect(TimeseriesPoint.safeParse({ date: "2026-01-01", clicks: "5", unique: 3 }).success).toBe(false);
    expect(TimeseriesPoint.safeParse({ date: "2026-01-01", clicks: 5, unique: 3, scans: 1 }).success).toBe(true);
  });
  it("Breakdown requires label string and value number, icon optional", () => {
    expect(Breakdown.parse({ label: "US", value: 10 }).label).toBe("US");
    expect(Breakdown.safeParse({ label: "US" }).success).toBe(false);
    expect(Breakdown.safeParse({ label: "US", value: "10" }).success).toBe(false);
    expect(Breakdown.safeParse({ label: "US", value: 10, icon: "flag" }).success).toBe(true);
  });
});

describe("Analytics shape with nested totals/deltas", () => {
  const breakdowns = { countries: [], cities: [], devices: [], browsers: [], referrers: [], tags: [], topLinks: [] };
  const valid = {
    totals: { clicks: 1, unique: 1, scans: 0, conversions: 0, blocked: 0 },
    deltas: { clicks: null, unique: 0.5, scans: null, conversions: 1 },
    series: [{ date: "2026-01-01", clicks: 1, unique: 1 }],
    ...breakdowns,
  };

  it("defaults granularity to day for older clients", () => {
    const parsed = Analytics.parse(valid);
    expect(parsed.granularity).toBe("day"); // kills granularity default("day")
  });

  it("requires the nested totals block with all five counters (kills the totals shape → {})", () => {
    const { clicks: _c, ...partialTotals } = valid.totals;
    expect(Analytics.safeParse({ ...valid, totals: partialTotals }).success).toBe(false);
    expect(Analytics.safeParse({ ...valid, totals: { ...valid.totals, blocked: "0" } }).success).toBe(false);
  });

  it("requires nullable-number deltas (kills the deltas shape → {})", () => {
    expect(Analytics.safeParse({ ...valid, deltas: { ...valid.deltas, clicks: "x" } }).success).toBe(false);
    expect(Analytics.safeParse({ ...valid, deltas: {} }).success).toBe(false); // missing keys
  });

  it("requires the top-level shape and the series array (kills Analytics shape → {})", () => {
    const { series: _s, ...noSeries } = valid;
    expect(Analytics.safeParse(noSeries).success).toBe(false);
    expect(Analytics.safeParse({ ...valid, countries: [{ label: "US" }] }).success).toBe(false); // bad Breakdown
  });
});

describe("AnalyticsQuery (#908) — strict, range default, uuid linkId", () => {
  it("defaults range to 30d", () => {
    expect(AnalyticsQuery.parse({}).range).toBe("30d"); // kills range default("30d")
  });
  it("rejects an unknown query param (kills .strict() dropped)", () => {
    expect(AnalyticsQuery.safeParse({ from: "2026-01-01" }).success).toBe(false);
    expect(AnalyticsQuery.safeParse({ rnge: "7d" }).success).toBe(false);
  });
  it("accepts a valid range and a uuid linkId, rejects a non-uuid linkId", () => {
    expect(AnalyticsQuery.safeParse({ range: "7d" }).success).toBe(true);
    expect(AnalyticsQuery.safeParse({ linkId: "11111111-1111-4111-8111-111111111111" }).success).toBe(true);
    expect(AnalyticsQuery.safeParse({ linkId: "not-a-uuid" }).success).toBe(false); // kills .uuid() drop
  });
});

describe("ConversionEvent / ExcludedConversions / RecordConversionResult shapes", () => {
  it("ConversionEvent requires id/kind/name/source/count with the kind enum", () => {
    const parsed = ConversionEvent.parse({ id: "e1", kind: "sale", name: "Pro plan", source: "web", count: 2 });
    expect(parsed.kind).toBe("sale");
    expect(ConversionEvent.safeParse({ id: "e1", kind: "refund", name: "x", source: "web", count: 1 }).success).toBe(false);
    expect(ConversionEvent.safeParse({ id: "e1", kind: "sale", name: "x", source: "web" }).success).toBe(false); // no count
  });
  it("ExcludedConversions requires an integer count and a byCurrency array", () => {
    const parsed = ExcludedConversions.parse({ count: 2, byCurrency: [{ currency: "USD", count: 2, valueMinor: 4900 }] });
    expect(parsed.byCurrency[0]!.valueMinor).toBe(4900);
    expect(ExcludedConversions.safeParse({ count: 1.5, byCurrency: [] }).success).toBe(false); // .int()
    expect(ExcludedConversions.safeParse({ count: 1, byCurrency: [{ currency: "US", count: 1, valueMinor: 1 }] }).success).toBe(false); // CurrencyCode length 3
  });
  it("RecordConversionResult requires nullable id and a recorded boolean", () => {
    expect(RecordConversionResult.parse({ id: null, recorded: false }).recorded).toBe(false);
    expect(RecordConversionResult.safeParse({ id: null }).success).toBe(false);
    expect(RecordConversionResult.safeParse({ id: null, recorded: "no" }).success).toBe(false);
  });
});

describe("CurrencyCode and ConversionsReport defaults", () => {
  it("CurrencyCode is exactly three characters", () => {
    expect(CurrencyCode.safeParse("INR").success).toBe(true);
    expect(CurrencyCode.safeParse("US").success).toBe(false);
    expect(CurrencyCode.safeParse("USDX").success).toBe(false);
  });
  it("ConversionsReport defaults currency to INR and excluded to a zero block", () => {
    const parsed = ConversionsReport.parse({
      totals: { clicks: 0, leads: 0, signups: 0, paid: 0, revenue: 0 },
      deltas: { clicks: null, leads: null, signups: null, paid: null, revenue: null },
      events: [],
      byLink: [],
      revenueSeries: [],
    });
    expect(parsed.currency).toBe("INR"); // kills currency default("INR")
    expect(parsed.excluded).toEqual({ count: 0, byCurrency: [] }); // kills excluded default({...}) drop + [] → ["Stryker..."]
  });
  it("requires the nested totals and deltas blocks (kills their shape → {})", () => {
    const base = {
      totals: { clicks: 0, leads: 0, signups: 0, paid: 0, revenue: 0 },
      deltas: { clicks: null, leads: null, signups: null, paid: null, revenue: null },
      events: [],
      byLink: [],
      revenueSeries: [],
    };
    expect(ConversionsReport.safeParse({ ...base, totals: { clicks: 0 } }).success).toBe(false);
    expect(ConversionsReport.safeParse({ ...base, revenueSeries: ["x"] }).success).toBe(false);
  });
});

describe("RecordConversionInput — G7 ingest validation", () => {
  it("requires the kind enum and a 1..120 char name", () => {
    expect(RecordConversionInput.safeParse({ kind: "lead", name: "Signup" }).success).toBe(true);
    expect(RecordConversionInput.safeParse({ kind: "bogus", name: "x" }).success).toBe(false);
    expect(RecordConversionInput.safeParse({ kind: "lead", name: "" }).success).toBe(false); // min(1)
    expect(RecordConversionInput.safeParse({ kind: "lead", name: "a".repeat(120) }).success).toBe(true);
    expect(RecordConversionInput.safeParse({ kind: "lead", name: "a".repeat(121) }).success).toBe(false); // max(120) → min(120) mutant rejects 120
  });
  it("defaults valueMinor to 0 and requires a non-negative integer (kills int()/min(0) mutants)", () => {
    expect(RecordConversionInput.parse({ kind: "sale", name: "x" }).valueMinor).toBe(0);
    expect(RecordConversionInput.safeParse({ kind: "sale", name: "x", valueMinor: -1 }).success).toBe(false); // min(0) → max(0) mutant accepts -1 but rejects 100
    expect(RecordConversionInput.safeParse({ kind: "sale", name: "x", valueMinor: 1999 }).success).toBe(true);
    expect(RecordConversionInput.safeParse({ kind: "sale", name: "x", valueMinor: 19.99 }).success).toBe(false); // int()
  });
  it("validates linkId as a uuid when present and caps externalId at 200", () => {
    expect(RecordConversionInput.safeParse({ kind: "lead", name: "x", linkId: "nope" }).success).toBe(false);
    expect(
      RecordConversionInput.safeParse({ kind: "lead", name: "x", linkId: "11111111-1111-4111-8111-111111111111" }).success,
    ).toBe(true);
    expect(RecordConversionInput.safeParse({ kind: "lead", name: "x", externalId: "a".repeat(200) }).success).toBe(true);
    expect(RecordConversionInput.safeParse({ kind: "lead", name: "x", externalId: "a".repeat(201) }).success).toBe(false);
  });
});


describe("ConversionsReport nested deltas / byLink shapes (kills the nested shape → {} mutants)", () => {
  const base = {
    totals: { clicks: 0, leads: 0, signups: 0, paid: 0, revenue: 0 },
    deltas: { clicks: null, leads: null, signups: null, paid: null, revenue: null },
    events: [],
    byLink: [],
    revenueSeries: [],
  };
  it("rejects a wrongly-typed delta value (a {} deltas shape would accept it)", () => {
    expect(ConversionsReport.safeParse({ ...base, deltas: { ...base.deltas, clicks: "x" } }).success).toBe(false);
    expect(ConversionsReport.safeParse({ ...base, deltas: { clicks: null } }).success).toBe(false); // missing keys
  });
  it("rejects a malformed byLink row (a {} row shape would accept it)", () => {
    expect(ConversionsReport.safeParse({ ...base, byLink: [{ link: "l" }] }).success).toBe(false); // missing campaign/clicks/…
    expect(
      ConversionsReport.safeParse({
        ...base,
        byLink: [{ link: "l", campaign: "c", clicks: "no", signups: 0, cvr: 0, revenue: 0 }],
      }).success,
    ).toBe(false);
  });
});
