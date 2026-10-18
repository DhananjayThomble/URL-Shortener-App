import { describe, expect, it } from "vitest";
import { FOREVER_YEARS } from "./retention";
import { isRetentionLowering, retentionLoweringWarning } from "./retention-change";

/* #780 — Settings applied a lower click-data retention with no warning, although
   the maintenance pass then permanently deletes the raw click rows past the new
   window. The decision "is this change a lowering?" is pure, so it is pinned here
   (web tests are Node-only); the dialog itself is covered by the Playwright spec.

   Retention is an integer number of years (1..100) and "Forever" is stored as
   FOREVER_YEARS (100), the contract maximum. */

describe("isRetentionLowering", () => {
  it("is true when the window gets shorter", () => {
    expect(isRetentionLowering(3, 1)).toBe(true);
    expect(isRetentionLowering(10, 3)).toBe(true);
    expect(isRetentionLowering(2, 1)).toBe(true);
  });

  it("treats Forever (100) as the longest window, so leaving it is a lowering", () => {
    expect(isRetentionLowering(FOREVER_YEARS, 3)).toBe(true);
    expect(isRetentionLowering(FOREVER_YEARS, 1)).toBe(true);
    expect(isRetentionLowering(FOREVER_YEARS, 99)).toBe(true);
  });

  it("is false when the window gets longer, including to Forever", () => {
    expect(isRetentionLowering(1, 3)).toBe(false);
    expect(isRetentionLowering(1, FOREVER_YEARS)).toBe(false);
    expect(isRetentionLowering(3, FOREVER_YEARS)).toBe(false);
    expect(isRetentionLowering(99, FOREVER_YEARS)).toBe(false);
  });

  it("is false when nothing changed", () => {
    expect(isRetentionLowering(1, 1)).toBe(false);
    expect(isRetentionLowering(3, 3)).toBe(false);
    expect(isRetentionLowering(FOREVER_YEARS, FOREVER_YEARS)).toBe(false);
  });

  it("treats anything at or past the Forever sentinel as the same 'Forever'", () => {
    expect(isRetentionLowering(FOREVER_YEARS + 50, FOREVER_YEARS)).toBe(false);
    expect(isRetentionLowering(FOREVER_YEARS, FOREVER_YEARS + 50)).toBe(false);
    expect(isRetentionLowering(FOREVER_YEARS + 50, 3)).toBe(true);
  });

  it("says no for a value the contract could never store, rather than guessing", () => {
    expect(isRetentionLowering(undefined, 1)).toBe(false);
    expect(isRetentionLowering(3, undefined)).toBe(false);
    expect(isRetentionLowering(null, 1)).toBe(false);
    expect(isRetentionLowering("3", 1)).toBe(false);
    expect(isRetentionLowering(3, 0)).toBe(false);
    expect(isRetentionLowering(3, -1)).toBe(false);
    expect(isRetentionLowering(3, 0.5)).toBe(false);
    expect(isRetentionLowering(Number.NaN, 1)).toBe(false);
    expect(isRetentionLowering(3, Number.NaN)).toBe(false);
    expect(isRetentionLowering(Number.POSITIVE_INFINITY, 1)).toBe(false);
  });
});

describe("retentionLoweringWarning", () => {
  it("is null for a change that deletes nothing new", () => {
    expect(retentionLoweringWarning(1, 3)).toBeNull();
    expect(retentionLoweringWarning(3, 3)).toBeNull();
    expect(retentionLoweringWarning(3, FOREVER_YEARS)).toBeNull();
    expect(retentionLoweringWarning(undefined, 1)).toBeNull();
  });

  it("names the new window with a singular year", () => {
    const w = retentionLoweringWarning(3, 1);
    expect(w).not.toBeNull();
    expect(w!.title).toBe("Delete click data older than 1 year?");
    expect(w!.body).toContain("older than 1 year");
    expect(w!.body).not.toContain("1 years");
  });

  it("names the new window with a plural year", () => {
    expect(retentionLoweringWarning(FOREVER_YEARS, 3)!.title).toBe("Delete click data older than 3 years?");
  });

  it("says the deletion is permanent, when it happens, and what survives", () => {
    const { body } = retentionLoweringWarning(FOREVER_YEARS, 1)!;
    expect(body).toMatch(/permanently deleted/);
    expect(body).toMatch(/next maintenance pass/);
    expect(body).toMatch(/hour/);
    expect(body).toMatch(/can.t be undone/);
    expect(body).toMatch(/rollups|totals/i);
  });

  it("never leaks the raw sentinel or an env var name into the copy", () => {
    const w = retentionLoweringWarning(FOREVER_YEARS, 3)!;
    for (const text of [w.title, w.body]) {
      expect(text).not.toContain("100");
      expect(text).not.toMatch(/CLICK_EVENTS|MAINTENANCE_INTERVAL|_SECONDS/);
    }
  });
});
