import { describe, expect, it } from "vitest";
import { NO_VALUE, ratePct, ratioRate } from "./utils";

/* #789: the conversions page drew the Paid rate with two decimals ("0.00%") and every
   other rate with one ("0.0%"), and the by-link table printed the raw number ("6%").
   One rule now: one decimal, "<0.1%" for a real rate that rounds to zero, a dash when
   there is nothing to divide by. */

describe("ratePct", () => {
  it("always uses one decimal", () => {
    expect(ratePct(0)).toBe("0.0%");
    expect(ratePct(6)).toBe("6.0%");
    expect(ratePct(3.7)).toBe("3.7%");
    expect(ratePct(12.34)).toBe("12.3%");
    expect(ratePct(100)).toBe("100.0%");
  });
  it("never shows two decimals", () => {
    for (const v of [0, 0.01, 0.04, 0.05, 0.1, 0.999, 1.005, 99.99]) expect(ratePct(v)).not.toMatch(/\.\d\d%/);
  });
  it("says <0.1% for a non-zero rate that one decimal would show as zero", () => {
    expect(ratePct(0.02)).toBe("<0.1%");
    expect(ratePct(0.049)).toBe("<0.1%");
    expect(ratePct(0.05)).toBe("0.1%");
  });
  it("is a dash for no value, negative or non-finite input", () => {
    for (const v of [null, undefined, Number.NaN, Number.POSITIVE_INFINITY, -1]) expect(ratePct(v)).toBe(NO_VALUE);
  });
});

describe("ratioRate", () => {
  it("is a dash when the denominator is zero", () => {
    expect(ratioRate(0, 0)).toBe(NO_VALUE);
    expect(ratioRate(5, 0)).toBe(NO_VALUE);
  });
  it("matches ratePct", () => {
    expect(ratioRate(0, 50)).toBe("0.0%");
    expect(ratioRate(2, 10000)).toBe("<0.1%");
    expect(ratioRate(1, 8)).toBe("12.5%");
  });
});
