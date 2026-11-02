import { describe, expect, it } from "vitest";
import { canAddCustomDomain } from "./domain-entitlements.js";

describe("canAddCustomDomain", () => {
  it("is false on the Free plan", () => {
    expect(canAddCustomDomain("Free")).toBe(false);
  });

  it("is true on a paid plan", () => {
    expect(canAddCustomDomain("Pro")).toBe(true);
    expect(canAddCustomDomain("Growth")).toBe(true);
  });

  it("is false while the plan is still unknown (session loading)", () => {
    expect(canAddCustomDomain(undefined)).toBe(false);
  });

  it("is false for an empty plan string", () => {
    expect(canAddCustomDomain("")).toBe(false);
  });

  it("treats an operator-set non-Free plan as allowed", () => {
    expect(canAddCustomDomain("TeamAnnual2026")).toBe(true);
  });
});
