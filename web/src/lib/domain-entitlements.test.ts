import { describe, expect, it } from "vitest";
import { canAddCustomDomain } from "./domain-entitlements.js";

describe("canAddCustomDomain", () => {
  it("is false on the Free plan", () => {
    expect(canAddCustomDomain("Free")).toBe(false);
  });

  it("is true on a seeded paid plan", () => {
    expect(canAddCustomDomain("Pro")).toBe(true);
    expect(canAddCustomDomain("Team")).toBe(true);
  });

  it("is false while the plan is still unknown (session loading)", () => {
    expect(canAddCustomDomain(undefined)).toBe(false);
  });

  it("is false for an empty plan string", () => {
    expect(canAddCustomDomain("")).toBe(false);
  });

  it("is false for an unknown plan key — fail closed (#970)", () => {
    // #970 flips #966's behaviour: the admin panel owns the plan catalogue, so a
    // plan key that is not a known plan is a mistake and must not grant a paid
    // feature. Mirrors the contract's entitlementsFor fail-closed resolution.
    expect(canAddCustomDomain("TeamAnnual2026")).toBe(false);
  });
});
