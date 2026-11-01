import { describe, expect, it } from "vitest";
import {
  entitlementsFor,
  planAllowsCustomDomains,
  PlanEntitlements,
  PLAN_ENTITLEMENTS,
  FREE_ENTITLEMENTS,
  PAID_ENTITLEMENTS,
} from "./entitlements.js";

describe("entitlementsFor", () => {
  it("gives the Free tier no custom domains and a zero cap", () => {
    const e = entitlementsFor("Free");
    expect(e.customDomains).toBe(false);
    expect(e.maxCustomDomains).toBe(0);
  });

  it("matches the plan name case-insensitively", () => {
    expect(entitlementsFor("free").customDomains).toBe(false);
    expect(entitlementsFor("FREE").customDomains).toBe(false);
    expect(entitlementsFor("PRO").customDomains).toBe(true);
    expect(entitlementsFor("pro").customDomains).toBe(true);
  });

  it("trims surrounding whitespace before matching", () => {
    expect(entitlementsFor("  Free  ").customDomains).toBe(false);
    expect(entitlementsFor("  Pro ").customDomains).toBe(true);
  });

  it("gives each named paid plan custom domains with a positive cap", () => {
    for (const name of ["Pro", "Team", "Business", "Growth", "Agency", "Enterprise"]) {
      const e = entitlementsFor(name);
      expect(e.customDomains).toBe(true);
      expect(e.maxCustomDomains).toBeGreaterThan(0);
    }
  });

  it("treats an empty plan string as Free (fails safe, not paid)", () => {
    expect(entitlementsFor("").customDomains).toBe(false);
    expect(entitlementsFor("   ").customDomains).toBe(false);
  });

  it("treats null and undefined as Free", () => {
    expect(entitlementsFor(null).customDomains).toBe(false);
    expect(entitlementsFor(undefined).customDomains).toBe(false);
  });

  it("treats an unknown non-empty plan as a paid tier", () => {
    // An operator sets plan names by hand; any non-Free name is a paid plan.
    const e = entitlementsFor("CustomEnterprisePlus");
    expect(e.customDomains).toBe(true);
    expect(e.maxCustomDomains).toBe(PAID_ENTITLEMENTS.maxCustomDomains);
  });

  it("never returns undefined", () => {
    expect(entitlementsFor("anything")).toBeDefined();
    expect(entitlementsFor("")).toBeDefined();
  });
});

describe("planAllowsCustomDomains", () => {
  it("is false for Free and true for paid", () => {
    expect(planAllowsCustomDomains("Free")).toBe(false);
    expect(planAllowsCustomDomains("Pro")).toBe(true);
  });

  it("mirrors entitlementsFor(...).customDomains exactly", () => {
    for (const name of ["Free", "Pro", "", "Mystery", "team", null, undefined]) {
      expect(planAllowsCustomDomains(name)).toBe(entitlementsFor(name).customDomains);
    }
  });
});

describe("the static table", () => {
  it("pins Free to the restricted entitlements", () => {
    expect(PLAN_ENTITLEMENTS.free).toBe(FREE_ENTITLEMENTS);
    expect(FREE_ENTITLEMENTS.customDomains).toBe(false);
    expect(FREE_ENTITLEMENTS.maxCustomDomains).toBe(0);
  });

  it("every row parses against the PlanEntitlements schema", () => {
    for (const row of Object.values(PLAN_ENTITLEMENTS)) {
      expect(() => PlanEntitlements.parse(row)).not.toThrow();
    }
  });

  it("keeps the paid cap positive and the free cap zero", () => {
    expect(PAID_ENTITLEMENTS.maxCustomDomains).toBeGreaterThan(0);
    expect(FREE_ENTITLEMENTS.maxCustomDomains).toBe(0);
  });
});
