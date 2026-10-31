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

  // Regression for #423: evaluateRouting used to partition into
  // conditional-then-catch-all regardless of author order, which disagreed
  // with validateRoutingChain's strict positional model ("a rule after an
  // unweighted catch-all can never run"). The contract's declared oracle for
  // chain evaluation ("First match wins", packages/contract/src/link.ts) is
  // positional, so an unweighted catch-all placed first must shadow every
  // rule that follows it, exactly as the save-time validator already assumes.
  it("lets an unweighted catch-all placed first shadow a later conditional rule", () => {
    const rules = [
      rule({ id: "everything", when: {}, then: "https://everything" }),
      rule({ id: "ios-only", when: { device: "ios" }, then: "https://apps.apple.com" }),
    ];
    const out = evaluateRouting(rules, "https://fallback", ctx({ device: "ios" }));
    expect(out.matchedRuleId).toBe("everything");
    expect(out.destination).toBe("https://everything");
  });

  it("still scans a weighted catch-all group positionally against an earlier conditional", () => {
    const rules = [
      rule({ id: "in", when: { country: "IN" }, then: "https://acme.in" }),
      rule({ id: "a", when: {}, then: "https://a", weight: 50 }),
      rule({ id: "b", when: {}, then: "https://b", weight: 50 }),
    ];
    const out = evaluateRouting(rules, "https://f", ctx({ country: "IN" }));
    expect(out.matchedRuleId).toBe("in");
  });

  // Regression: validateRoutingChain sums every weighted catch-all's weight
  // against the whole chain, not just a consecutive run, so it accepts a
  // conditional interleaved between two weighted catch-alls as one valid
  // 100% split — `[weight 50 -> A, {country: IN} -> IN, weight 50 -> B]`.
  // evaluateRouting must agree: the visitor matched by the interleaved
  // conditional gets it, and every other visitor still splits across BOTH
  // weighted catch-alls (not just the one the scan reaches first).
  it("treats every weighted catch-all in the chain as one split even when a conditional is interleaved", () => {
    const rules = [
      rule({ id: "a", when: {}, then: "https://a", weight: 50 }),
      rule({ id: "in", when: { country: "IN" }, then: "https://acme.in" }),
      rule({ id: "b", when: {}, then: "https://b", weight: 50 }),
    ];
    expect(validateRoutingChain(rules)).toEqual([]);

    const inVisitor = evaluateRouting(rules, "https://f", ctx({ country: "IN" }));
    expect(inVisitor.matchedRuleId).toBe("in");
    expect(inVisitor.destination).toBe("https://acme.in");

    let a = 0;
    let b = 0;
    const n = 4000;
    for (let i = 0; i < n; i++) {
      const out = evaluateRouting(rules, "https://f", ctx({ country: "US", visitorHash: `visitor-${i}` }));
      if (out.matchedRuleId === "a") a++;
      if (out.matchedRuleId === "b") b++;
    }
    expect(a + b).toBe(n);
    expect(a / n).toBeGreaterThan(0.45);
    expect(a / n).toBeLessThan(0.55);
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


/* #894 — mutation testing. The tests above prove routing behaviour at the
   feature level; these pin the remaining boundary arithmetic, the weighted-
   catch-all predicate, and the validator's exact messages so no mutant of them
   survives. */
describe("isCatchAll via evaluateRouting — a rule with ANY single condition is not a catch-all", () => {
  it.each<[string, Partial<RoutingRule["when"]>]>([
    ["country only", { country: "IN" }],
    ["device only", { device: "ios" }],
    ["language only", { language: "fr" }],
  ])("a %s rule is conditional, so a non-matching visitor falls through", (_label, when) => {
    // If any of country/device/language were dropped from isCatchAll, such a
    // rule would be misread as a catch-all and match everyone.
    const rules = [rule({ id: "cond", when, then: "https://cond" })];
    const out = evaluateRouting(rules, "https://fallback", ctx({ country: "ZZ", device: "desktop", language: "zz" }));
    expect(out.destination).toBe("https://fallback");
    expect(out.matchedRuleId).toBeNull();
  });
});

describe("pickWeighted boundaries", () => {
  it("routes everyone to the first arm when all weights are zero or missing", () => {
    // total <= 0 returns rules[0]; a mutant flipping the guard would index past
    // the array or divide by zero.
    const rules = [
      rule({ id: "a", when: {}, then: "https://a", weight: 0 }),
      rule({ id: "b", when: {}, then: "https://b", weight: 0 }),
    ];
    for (let i = 0; i < 20; i++) {
      expect(evaluateRouting(rules, "https://f", ctx({ visitorHash: `v${i}` })).matchedRuleId).toBe("a");
    }
  });

  it("reports the chosen arm as a variant N/total", () => {
    const rules = [
      rule({ id: "a", when: {}, then: "https://a", weight: 50 }),
      rule({ id: "b", when: {}, then: "https://b", weight: 50 }),
    ];
    const out = evaluateRouting(rules, "https://f", ctx({ visitorHash: "sticky" }));
    expect(out.variant).toMatch(/^[12]\/2$/);
  });
});

describe("validateRoutingChain — exact boundaries and messages", () => {
  it("accepts weights that total exactly 100 and rejects just off it", () => {
    const ok = [
      rule({ when: {}, then: "https://a", weight: 50 }),
      rule({ when: {}, then: "https://b", weight: 50 }),
    ];
    expect(validateRoutingChain(ok)).toEqual([]);
    const off = [
      rule({ when: {}, then: "https://a", weight: 50 }),
      rule({ when: {}, then: "https://b", weight: 49.98 }),
    ];
    // 0.02 off exceeds the 0.01 tolerance; the message quotes the real total
    // and says it is not 100%.
    const problem = validateRoutingChain(off)[0]!;
    expect(problem).toMatch(/not 100%\.$/);
    expect(problem).toContain("99.9");
  });

  it("accepts weights within the 0.01 rounding tolerance", () => {
    const rules = [
      rule({ when: {}, then: "https://a", weight: 33.333 }),
      rule({ when: {}, then: "https://b", weight: 33.333 }),
      rule({ when: {}, then: "https://c", weight: 33.334 }),
    ];
    expect(validateRoutingChain(rules)).toEqual([]);
  });

  it("flags a one-armed split but not a two-armed one", () => {
    expect(validateRoutingChain([rule({ when: {}, then: "https://a", weight: 100 })])[0]).toContain(
      "at least two destinations",
    );
    expect(
      validateRoutingChain([
        rule({ when: {}, then: "https://a", weight: 50 }),
        rule({ when: {}, then: "https://b", weight: 50 }),
      ]),
    ).toEqual([]);
  });

  it("counts stranded rules and uses the singular/plural form correctly", () => {
    const one = [
      rule({ when: {}, then: "https://everything" }),
      rule({ when: { country: "IN" }, then: "https://in" }),
    ];
    expect(validateRoutingChain(one)[0]).toBe('1 rule after "everything else" can never match. Move them above it.');

    const two = [
      rule({ when: {}, then: "https://everything" }),
      rule({ when: { country: "IN" }, then: "https://in" }),
      rule({ when: { device: "ios" }, then: "https://ios" }),
    ];
    expect(validateRoutingChain(two)[0]).toBe('2 rules after "everything else" can never match. Move them above it.');
  });

  it("does not flag an unweighted catch-all that is genuinely last", () => {
    const rules = [
      rule({ when: { country: "IN" }, then: "https://in" }),
      rule({ when: {}, then: "https://everything" }),
    ];
    expect(validateRoutingChain(rules)).toEqual([]);
  });

  it("detects duplicate conditions case-insensitively across country and language", () => {
    const rules = [
      rule({ when: { country: "IN", language: "EN" }, then: "https://one" }),
      rule({ when: { country: "in", language: "en" }, then: "https://two" }),
    ];
    expect(validateRoutingChain(rules).some((p) => p.includes("identical"))).toBe(true);
  });

  it("does not call rules with different device conditions duplicates", () => {
    const rules = [
      rule({ when: { device: "ios" }, then: "https://one" }),
      rule({ when: { device: "android" }, then: "https://two" }),
    ];
    expect(validateRoutingChain(rules)).toEqual([]);
  });
});


/* #894 — mutation testing, second pass. These pin the remaining validator
   predicates and the dedup key's slot independence. */
describe("validateRoutingChain — weighted predicate and key slots", () => {
  it("treats a catch-all with weight 0 as unweighted, not a split arm", () => {
    // isWeightedCatchAll requires weight > 0. A weight-0 catch-all is therefore
    // an ordinary "everything else", so a rule placed after it is stranded.
    // Kills the `weight > 0` -> `weight >= 0` mutant (which would count it as a
    // split arm and raise the one-armed-split error instead).
    const rules = [
      rule({ when: {}, then: "https://everything", weight: 0 }),
      rule({ when: { country: "IN" }, then: "https://in" }),
    ];
    const problems = validateRoutingChain(rules);
    expect(problems.some((p) => p.includes("can never match"))).toBe(true);
    expect(problems.some((p) => p.includes("at least two"))).toBe(false);
  });

  it("does not raise the one-armed-split error for a valid two-arm split", () => {
    // Kills `weighted.length === 1` -> `>= 1`.
    expect(
      validateRoutingChain([
        rule({ when: {}, then: "https://a", weight: 50 }),
        rule({ when: {}, then: "https://b", weight: 50 }),
      ]),
    ).toEqual([]);
  });

  it("raises the one-armed-split error only for exactly one weighted arm", () => {
    expect(validateRoutingChain([rule({ when: {}, then: "https://a", weight: 100 })])).toEqual([
      "A split test needs at least two destinations to split between.",
    ]);
    // Zero weighted arms: no split error.
    expect(validateRoutingChain([rule({ when: { country: "IN" }, then: "https://in" })])).toEqual([]);
  });

  it("checks the weight total only when there is more than one arm", () => {
    // A single arm must not reach the total check (which would read 100 off a
    // one-arm 100% and stay silent anyway, but the guard is pinned here).
    expect(validateRoutingChain([rule({ when: {}, then: "https://a", weight: 100 })])).toEqual([
      "A split test needs at least two destinations to split between.",
    ]);
  });

  it("counts stranded rules from the correct catch-all position", () => {
    // firstCatchAll is at index 1; 3 total rules => 1 stranded. A mutated
    // `rules.length + firstCatchAll` arithmetic would miscount.
    const rules = [
      rule({ when: { country: "IN" }, then: "https://in" }),
      rule({ when: {}, then: "https://everything" }),
      rule({ when: { device: "ios" }, then: "https://ios" }),
    ];
    expect(validateRoutingChain(rules)[0]).toBe('1 rule after "everything else" can never match. Move them above it.');
  });

  it("keeps country and language in distinct key slots (a country difference is not a duplicate)", () => {
    // If the country slot collapsed to null (the `?? null` -> `&& null`
    // mutant), these two would be wrongly flagged as identical.
    const rules = [
      rule({ when: { country: "IN", device: "ios" }, then: "https://in" }),
      rule({ when: { country: "US", device: "ios" }, then: "https://us" }),
    ];
    expect(validateRoutingChain(rules).some((p) => p.includes("identical"))).toBe(false);
  });

  it("flags two rules identical once case is normalised, across all three slots", () => {
    const rules = [
      rule({ when: { country: "IN", device: "ios", language: "EN" }, then: "https://one" }),
      rule({ when: { country: "in", device: "ios", language: "en" }, then: "https://two" }),
    ];
    expect(validateRoutingChain(rules).some((p) => p.includes("identical"))).toBe(true);
  });

  it("treats a language-only difference as distinct (language slot is real)", () => {
    const rules = [
      rule({ when: { language: "en" }, then: "https://en" }),
      rule({ when: { language: "fr" }, then: "https://fr" }),
    ];
    expect(validateRoutingChain(rules).some((p) => p.includes("identical"))).toBe(false);
  });
});

describe("evaluateRouting — device-family matching detail", () => {
  it("a mobile rule matches ios, android and mobile but not desktop", () => {
    const rules = [rule({ id: "m", when: { device: "mobile" }, then: "https://m" })];
    for (const device of ["ios", "android", "mobile"] as const) {
      expect(evaluateRouting(rules, "https://f", ctx({ device })).matchedRuleId).toBe("m");
    }
    expect(evaluateRouting(rules, "https://f", ctx({ device: "desktop" })).matchedRuleId).toBeNull();
  });

  it("an explicit device rule matches only that exact device", () => {
    const rules = [rule({ id: "i", when: { device: "ios" }, then: "https://i" })];
    expect(evaluateRouting(rules, "https://f", ctx({ device: "ios" })).matchedRuleId).toBe("i");
    for (const device of ["android", "mobile", "desktop"] as const) {
      expect(evaluateRouting(rules, "https://f", ctx({ device })).matchedRuleId).toBeNull();
    }
  });

  it("a device rule does not match a visitor with an unknown (null) device", () => {
    const rules = [rule({ id: "m", when: { device: "mobile" }, then: "https://m" })];
    expect(evaluateRouting(rules, "https://f", ctx({ device: null })).matchedRuleId).toBeNull();
  });
});


/* #894 — mutation testing, third pass: pin isWeightedCatchAll and the validator
   weighted-filter precisely via observable variant/matchedRuleId/problem lists. */
describe("isWeightedCatchAll via evaluateRouting — observable effects", () => {
  it("a weight-0 catch-all is matched positionally with NO variant (not a split arm)", () => {
    // If isWeightedCatchAll counted weight 0 (the `> 0` -> `>= 0` mutant), the
    // rule would be skipped by the positional scan and chosen via the weighted
    // path instead, which stamps a `variant`. Correct behaviour: it matches in
    // the scan with variant === null.
    const rules = [rule({ id: "zero", when: {}, then: "https://zero", weight: 0 })];
    const out = evaluateRouting(rules, "https://f", ctx());
    expect(out.matchedRuleId).toBe("zero");
    expect(out.variant).toBeNull();
  });

  it("a conditional rule that also carries a weight is NOT a split arm", () => {
    // isWeightedCatchAll requires isCatchAll (no conditions). A rule with a
    // country AND a weight must match positionally, not via the weighted pick.
    const rules = [
      rule({ id: "cond", when: { country: "IN" }, then: "https://in", weight: 50 }),
      rule({ id: "a", when: {}, then: "https://a", weight: 50 }),
      rule({ id: "b", when: {}, then: "https://b", weight: 50 }),
    ];
    const out = evaluateRouting(rules, "https://f", ctx({ country: "IN" }));
    expect(out.matchedRuleId).toBe("cond");
    expect(out.variant).toBeNull();
  });

  it("a positive-weight catch-all IS a split arm, stamped with a variant", () => {
    const rules = [
      rule({ id: "a", when: {}, then: "https://a", weight: 50 }),
      rule({ id: "b", when: {}, then: "https://b", weight: 50 }),
    ];
    const out = evaluateRouting(rules, "https://f", ctx({ visitorHash: "x" }));
    expect(out.variant).toMatch(/^[12]\/2$/);
    expect(["a", "b"]).toContain(out.matchedRuleId);
  });
});

describe("validateRoutingChain — weighted filter requires isCatchAll", () => {
  it("does not count a conditional weighted rule toward the split total", () => {
    // weighted = rules.filter(isCatchAll).filter(weight>0). Dropping the
    // isCatchAll filter (the `rules.filter(isCatchAll)` -> `rules` mutant) would
    // pull the conditional weighted rule into the split and change the total.
    // Here the two true catch-alls already total 100; the conditional's weight
    // must be ignored, so the chain is valid.
    const rules = [
      rule({ when: { country: "IN" }, then: "https://in", weight: 999 }),
      rule({ when: {}, then: "https://a", weight: 50 }),
      rule({ when: {}, then: "https://b", weight: 50 }),
    ];
    expect(validateRoutingChain(rules)).toEqual([]);
  });

  it("raises exactly the one-armed error for a single weighted catch-all among conditional rules", () => {
    const rules = [
      rule({ when: { country: "IN" }, then: "https://in" }),
      rule({ when: {}, then: "https://only", weight: 100 }),
    ];
    expect(validateRoutingChain(rules)).toEqual([
      "A split test needs at least two destinations to split between.",
    ]);
  });

  it("does NOT run the weight-total check for a one-armed split (only length>1 does)", () => {
    // A single weighted arm with a non-100 weight: the ONLY problem must be the
    // one-armed error, never a "weights add up to N%" message. If the total
    // check gate `weighted.length > 1` were weakened to `>= 1`, this one-arm
    // chain would ALSO run the total check and append a second (weights) error.
    const rules = [rule({ when: {}, then: "https://only", weight: 50 })];
    expect(validateRoutingChain(rules)).toEqual([
      "A split test needs at least two destinations to split between.",
    ]);
    // And a two-arm chain whose weights DO total 100 raises nothing — the
    // total check runs (length>1) and passes.
    expect(
      validateRoutingChain([
        rule({ when: {}, then: "https://a", weight: 50 }),
        rule({ when: {}, then: "https://b", weight: 50 }),
      ]),
    ).toEqual([]);
  });
});
