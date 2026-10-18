import { describe, expect, it } from "vitest";
import { analyticsSubtitle, FOREVER_YEARS, retentionLabel } from "./retention";

/* #769 — the Analytics header claimed "3 years retention" whatever the
   workspace had chosen. The contract stores retention as an integer number of
   YEARS (1..100, where the Settings "Forever" choice is 100), so there are no
   months or days to render. Anything that is not a valid stored value must
   produce no claim at all rather than a guess. */

describe("retentionLabel", () => {
  it("uses the singular for one year", () => {
    expect(retentionLabel(1)).toBe("1 year retention");
  });

  it("uses the plural for every other year count the Settings page offers", () => {
    expect(retentionLabel(3)).toBe("3 years retention");
  });

  it("pluralises any other whole number of years", () => {
    expect(retentionLabel(2)).toBe("2 years retention");
    expect(retentionLabel(10)).toBe("10 years retention");
    expect(retentionLabel(99)).toBe("99 years retention");
  });

  it("does not claim a number of years for 'Forever' (stored as 100, clamped to the install limit)", () => {
    expect(retentionLabel(FOREVER_YEARS)).toBe("maximum retention");
    expect(retentionLabel(FOREVER_YEARS + 1)).toBe("maximum retention");
    expect(retentionLabel(Number.MAX_SAFE_INTEGER)).toBe("maximum retention");
  });

  it("makes no claim for a missing or unknown value", () => {
    expect(retentionLabel(undefined)).toBeNull();
    expect(retentionLabel(null)).toBeNull();
    expect(retentionLabel("3")).toBeNull();
    expect(retentionLabel({})).toBeNull();
  });

  it("makes no claim for a value the contract could never store", () => {
    expect(retentionLabel(0)).toBeNull();
    expect(retentionLabel(-1)).toBeNull();
    expect(retentionLabel(0.5)).toBeNull();
    expect(retentionLabel(1.5)).toBeNull();
    expect(retentionLabel(Number.NaN)).toBeNull();
    expect(retentionLabel(Number.POSITIVE_INFINITY)).toBeNull();
  });
});

describe("analyticsSubtitle", () => {
  const BASE = "No cookies set · click data never sold";

  it("appends the workspace's own retention", () => {
    expect(analyticsSubtitle(1)).toBe(`${BASE} · 1 year retention`);
    expect(analyticsSubtitle(3)).toBe(`${BASE} · 3 years retention`);
    expect(analyticsSubtitle(FOREVER_YEARS)).toBe(`${BASE} · maximum retention`);
  });

  it("drops the retention segment (and its separator) while it is unknown", () => {
    expect(analyticsSubtitle(undefined)).toBe(BASE);
    expect(analyticsSubtitle(0)).toBe(BASE);
    expect(analyticsSubtitle(2.5)).toBe(BASE);
  });
});
