import { describe, expect, it } from "vitest";
import { fillSeries, iso, percentChange, windowFor } from "./analytics.service.js";

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
