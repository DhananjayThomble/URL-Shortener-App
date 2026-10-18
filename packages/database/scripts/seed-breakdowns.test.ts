import { describe, expect, it } from "vitest";
import { dailyBreakdowns, SEED_BREAKDOWNS } from "./seed-breakdowns";

/* Every dimension GET /analytics reads from breakdown_daily
   (apps/api/src/analytics/analytics.service.ts). Listed here rather than
   imported because the database package cannot depend on the API. */
const READ_BY_ANALYTICS = ["country", "city", "device", "browser", "referrer"];

/* Mirrors CITY_MIN_CLICKS in analytics.service.ts: a city below it is folded
   into "Other cities" rather than named. */
const CITY_MIN_CLICKS = 5;

describe("seed breakdowns (#772)", () => {
  it("writes every dimension the analytics endpoint reads", () => {
    const written = new Set(dailyBreakdowns(500).map((r) => r.dimension));
    for (const dimension of READ_BY_ANALYTICS) expect(written, dimension).toContain(dimension);
  });

  it("each dimension's mix accounts for every click (shares sum to 100)", () => {
    for (const [dimension, mix] of Object.entries(SEED_BREAKDOWNS)) {
      expect(mix.reduce((s, [, share]) => s + share, 0), dimension).toBe(100);
      expect(new Set(mix.map(([v]) => v)).size, `${dimension} has duplicate values`).toBe(mix.length);
    }
  });

  it("names real cities on a small day, so the k-anonymity floor does not fold them all", () => {
    const named = dailyBreakdowns(100).filter(
      (r) => r.dimension === "city" && r.value !== "Unknown" && r.count >= CITY_MIN_CLICKS,
    );
    expect(named.length).toBeGreaterThanOrEqual(3);
  });

  it("includes an Unknown city bucket, as real traffic CloudFront cannot place does", () => {
    expect(dailyBreakdowns(500).some((r) => r.dimension === "city" && r.value === "Unknown")).toBe(true);
  });

  it("skips zero-count rows and writes nothing for a zero-click day", () => {
    expect(dailyBreakdowns(0)).toEqual([]);
    expect(dailyBreakdowns(1).every((r) => r.count > 0)).toBe(true);
  });
});
