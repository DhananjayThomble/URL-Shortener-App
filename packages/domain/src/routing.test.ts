import { describe, expect, it } from "vitest";
import type { RoutingRule } from "@snapurl/contract";
import { evaluateRouting, validateRoutingChain, type VisitorContext } from "./routing.js";

/* The routing chain decides where a real person lands. These tests exist
   because a bug here is invisible in code review and very visible to a
   customer whose campaign traffic went to the wrong store. */

const ctx = (over: Partial<VisitorContext> = {}): VisitorContext => ({
  country: "US",
  device: "desktop",
  language: "en",
  visitorHash: "abc123",
  ...over,
});

const rule = (over: Partial<RoutingRule> & { then: string }): RoutingRule => ({
  id: over.id ?? Math.random().toString(36).slice(2),
  when: over.when ?? {},
  then: over.then,
  weight: over.weight ?? null,
});

describe("evaluateRouting", () => {
  it("falls back to the link's own destination when there are no rules", () => {
    const out = evaluateRouting([], "https://acme.com", ctx());
    expect(out.destination).toBe("https://acme.com");
    expect(out.matchedRuleId).toBeNull();
  });

  it("takes the first matching rule, not the best one", () => {
    const rules = [
      rule({ id: "r1", when: { country: "IN" }, then: "https://acme.in" }),
      rule({ id: "r2", when: { country: "IN", device: "ios" }, then: "https://apps.apple.com" }),
    ];
    const out = evaluateRouting(rules, "https://acme.com", ctx({ country: "IN", device: "ios" }));
    expect(out.matchedRuleId).toBe("r1");
  });

  it("requires every stated condition to hold", () => {
    const rules = [rule({ id: "r1", when: { country: "IN", device: "ios" }, then: "https://in-ios" })];
    expect(evaluateRouting(rules, "https://fallback", ctx({ country: "IN", device: "android" })).destination)
      .toBe("https://fallback");
  });

  it("treats country matching as case-insensitive", () => {
    const rules = [rule({ when: { country: "in" }, then: "https://acme.in" })];
    expect(evaluateRouting(rules, "https://fallback", ctx({ country: "IN" })).destination)
      .toBe("https://acme.in");
  });

  it("lets an iOS visitor satisfy a 'mobile' rule", () => {
    const rules = [rule({ when: { device: "mobile" }, then: "https://m.acme.com" })];
    expect(evaluateRouting(rules, "https://fallback", ctx({ device: "ios" })).destination)
      .toBe("https://m.acme.com");
  });

  it("does not let an Android visitor satisfy an explicit 'ios' rule", () => {
    const rules = [rule({ when: { device: "ios" }, then: "https://apps.apple.com" })];
    expect(evaluateRouting(rules, "https://fallback", ctx({ device: "android" })).destination)
      .toBe("https://fallback");
  });

  it("keeps the same visitor in the same A/B bucket across clicks", () => {
    const rules = [
      rule({ id: "a", when: {}, then: "https://variant-a", weight: 50 }),
      rule({ id: "b", when: {}, then: "https://variant-b", weight: 50 }),
    ];
    const visitor = ctx({ visitorHash: "sticky-visitor" });
    const first = evaluateRouting(rules, "https://fallback", visitor);
    for (let i = 0; i < 25; i++) {
      expect(evaluateRouting(rules, "https://fallback", visitor).matchedRuleId).toBe(first.matchedRuleId);
    }
  });

  it("splits roughly evenly across many visitors", () => {
    const rules = [
      rule({ id: "a", when: {}, then: "https://a", weight: 50 }),
      rule({ id: "b", when: {}, then: "https://b", weight: 50 }),
    ];
    let a = 0;
    const n = 4000;
    for (let i = 0; i < n; i++) {
      const out = evaluateRouting(rules, "https://fallback", ctx({ visitorHash: `visitor-${i}` }));
      if (out.matchedRuleId === "a") a++;
    }
    expect(a / n).toBeGreaterThan(0.45);
    expect(a / n).toBeLessThan(0.55);
  });

  it("honours uneven weights", () => {
    const rules = [
      rule({ id: "a", when: {}, then: "https://a", weight: 90 }),
      rule({ id: "b", when: {}, then: "https://b", weight: 10 }),
    ];
    let a = 0;
    const n = 4000;
    for (let i = 0; i < n; i++) {
      if (evaluateRouting(rules, "https://f", ctx({ visitorHash: `v${i}` })).matchedRuleId === "a") a++;
    }
    expect(a / n).toBeGreaterThan(0.86);
    expect(a / n).toBeLessThan(0.94);
  });

  it("prefers a conditional rule over a weighted split", () => {
    const rules = [
      rule({ id: "in", when: { country: "IN" }, then: "https://acme.in" }),
      rule({ id: "a", when: {}, then: "https://a", weight: 50 }),
      rule({ id: "b", when: {}, then: "https://b", weight: 50 }),
    ];
    expect(evaluateRouting(rules, "https://f", ctx({ country: "IN" })).matchedRuleId).toBe("in");
  });

  it("handles a null country without matching a country rule", () => {
    const rules = [rule({ when: { country: "IN" }, then: "https://acme.in" })];
    expect(evaluateRouting(rules, "https://fallback", ctx({ country: null })).destination)
      .toBe("https://fallback");
  });
});

describe("validateRoutingChain", () => {
  it("accepts a well-formed chain", () => {
    const rules = [
      rule({ when: { country: "IN" }, then: "https://acme.in" }),
      rule({ when: {}, then: "https://a", weight: 50 }),
      rule({ when: {}, then: "https://b", weight: 50 }),
    ];
    expect(validateRoutingChain(rules)).toEqual([]);
  });

  it("rejects split weights that do not total 100", () => {
    const rules = [
      rule({ when: {}, then: "https://a", weight: 60 }),
      rule({ when: {}, then: "https://b", weight: 30 }),
    ];
    expect(validateRoutingChain(rules)[0]).toContain("90%");
  });

  it("rejects a one-armed split", () => {
    expect(validateRoutingChain([rule({ when: {}, then: "https://a", weight: 100 })])[0])
      .toContain("at least two");
  });

  it("flags rules stranded after an everything-else rule", () => {
    const rules = [
      rule({ when: {}, then: "https://everything" }),
      rule({ when: { country: "IN" }, then: "https://acme.in" }),
    ];
    expect(validateRoutingChain(rules)[0]).toContain("can never match");
  });

  it("flags duplicate conditions", () => {
    const rules = [
      rule({ when: { country: "IN" }, then: "https://one" }),
      rule({ when: { country: "in" }, then: "https://two" }),
    ];
    expect(validateRoutingChain(rules).some((p) => p.includes("identical"))).toBe(true);
  });
});
