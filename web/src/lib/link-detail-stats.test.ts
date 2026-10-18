import { describe, expect, it } from "vitest";
import { allTimeNote, headlineStats, rangeValue } from "./link-detail-stats";

/* #768 — oracle: the issue's acceptance criteria. The headline tiles carry the
   selected range's totals from the analytics response; the link's all-time
   counters appear only as a labelled secondary figure. */

const link = { clicks: 21504, uniqueClicks: 17000 };
const analytics = { totals: { clicks: 9207, unique: 7100, scans: 0, conversions: 0, blocked: 0 } };

describe("headlineStats", () => {
  it("shows the range total as the value, not the all-time counter", () => {
    const s = headlineStats(link, analytics);
    expect(s.clicks.value).toBe("9,207");
    expect(s.unique.value).toBe("7,100");
  });

  it("labels the all-time counter as such", () => {
    const s = headlineStats(link, analytics);
    expect(s.clicks.allTime).toBe("21,504 all-time");
    expect(s.unique.allTime).toBe("17,000 all-time");
  });

  it("never falls back to the all-time figure while the range is loading", () => {
    const s = headlineStats(link, undefined);
    expect(s.clicks.value).toBe("—");
    expect(s.unique.value).toBe("—");
    expect(s.clicks.allTime).toBe("21,504 all-time");
  });

  it("renders a genuine zero for a quiet range on a busy link", () => {
    const s = headlineStats(link, { totals: { clicks: 0, unique: 0, scans: 0, conversions: 0, blocked: 0 } });
    expect(s.clicks.value).toBe("0");
    expect(s.clicks.allTime).toBe("21,504 all-time");
  });

  it("omits the all-time line for a link with no unique counter", () => {
    expect(headlineStats({ clicks: 5, uniqueClicks: null }, analytics).unique.allTime).toBeUndefined();
    expect(headlineStats({ clicks: 5 }, analytics).unique.allTime).toBeUndefined();
  });
});

describe("allTimeNote / rangeValue", () => {
  it("handles zero, and refuses non-finite input", () => {
    expect(allTimeNote(0)).toBe("0 all-time");
    expect(allTimeNote(Number.NaN)).toBeUndefined();
    expect(rangeValue(Number.NaN)).toBe("—");
    expect(rangeValue(0)).toBe("0");
  });
});
