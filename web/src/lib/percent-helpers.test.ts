import { describe, expect, it } from "vitest";
import { NO_VALUE, dropOff, dropOffLabel, formatDelta, ratioPct } from "./utils";

/* Issue #662: the conversions funnel and the analytics tiles rendered
   "NaN%", "-Infinity%", "▲ 0.0%" and "▲ 100.0%" for a workspace with no
   baseline. These pin the rule: no meaningful comparison -> a dash, never a
   numeric artefact of dividing by zero. */

const BAD = /NaN|Infinity/;

describe("dropOff", () => {
  it("is null when the previous step is zero and the current is zero (0/0)", () => {
    expect(dropOff(0, 0)).toBeNull();
  });
  it("is null when the previous step is zero and the current is not (x/0)", () => {
    expect(dropOff(0, 1)).toBeNull();
  });
  it("is 100 when the current step is zero and the previous is not", () => {
    expect(dropOff(100, 0)).toBe(100);
  });
  it("computes an ordinary drop", () => {
    expect(dropOff(200, 50)).toBe(75);
    expect(dropOff(10, 10)).toBe(0);
  });
  it("goes negative when a step is larger than the one before it", () => {
    expect(dropOff(10, 15)).toBe(-50);
  });
  it("is null for non-finite input", () => {
    expect(dropOff(Number.NaN, 1)).toBeNull();
    expect(dropOff(1, Number.POSITIVE_INFINITY)).toBeNull();
  });
});

describe("dropOffLabel", () => {
  it("renders a dash for a zero previous step, never NaN or Infinity", () => {
    expect(dropOffLabel(0, 0)).toBe(`${NO_VALUE} drop off`);
    expect(dropOffLabel(0, 1)).toBe(`${NO_VALUE} drop off`);
    expect(dropOffLabel(0, 0)).not.toMatch(BAD);
    expect(dropOffLabel(0, 1)).not.toMatch(BAD);
  });
  it("renders a full drop when the current step is zero", () => {
    expect(dropOffLabel(100, 0)).toBe("▼ 100.0% drop off");
  });
  it("renders a normal drop", () => {
    expect(dropOffLabel(200, 50)).toBe("▼ 75.0% drop off");
  });
  it("says so when a step is larger than the one before it, rather than a negative drop", () => {
    expect(dropOffLabel(10, 15)).toBe("▲ 50.0% more than the step before");
  });
});

describe("ratioPct", () => {
  it("is a dash for a zero denominator (0/0 and x/0)", () => {
    expect(ratioPct(0, 0)).toBe(NO_VALUE);
    expect(ratioPct(5, 0)).toBe(NO_VALUE);
  });
  it("is 0.0% for a zero numerator over a real denominator", () => {
    expect(ratioPct(0, 50)).toBe("0.0%");
  });
  it("computes a normal rate at the requested precision", () => {
    expect(ratioPct(1, 8)).toBe("12.5%");
    expect(ratioPct(1, 3, 2)).toBe("33.33%");
  });
});

describe("formatDelta", () => {
  it("is a neutral dash when there is no baseline (null)", () => {
    expect(formatDelta(null)).toEqual({ text: NO_VALUE, tone: "flat" });
    expect(formatDelta(undefined)).toEqual({ text: NO_VALUE, tone: "flat" });
  });
  it("is the same neutral dash for a zero change, with no arrow either way", () => {
    expect(formatDelta(0)).toEqual({ text: NO_VALUE, tone: "flat" });
    expect(formatDelta(-0)).toEqual({ text: NO_VALUE, tone: "flat" });
    expect(formatDelta(0.04)).toEqual({ text: NO_VALUE, tone: "flat" });
  });
  it("never renders NaN or Infinity", () => {
    expect(formatDelta(Number.NaN).text).toBe(NO_VALUE);
    expect(formatDelta(Number.POSITIVE_INFINITY).text).toBe(NO_VALUE);
    expect(formatDelta(Number.NEGATIVE_INFINITY).text).not.toMatch(BAD);
  });
  it("keeps a genuine +100% (a doubling) as a number", () => {
    expect(formatDelta(100)).toEqual({ text: "▲ 100.0%", tone: "up" });
  });
  it("shows growth up and decline down, whatever the metric", () => {
    expect(formatDelta(22.6)).toEqual({ text: "▲ 22.6%", tone: "up" });
    expect(formatDelta(-2.4)).toEqual({ text: "▼ 2.4%", tone: "down" });
  });
});
