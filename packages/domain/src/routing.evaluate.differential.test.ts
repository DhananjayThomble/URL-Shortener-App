import { describe, expect, it } from "vitest";
import fc from "fast-check";
import type { RoutingRule, DeviceType } from "@snapurl/contract";
import { evaluateRouting, validateRoutingChain, type VisitorContext } from "./routing.js";
import { evaluateRoutingReference } from "./routing.reference.js";

/* ============================================================
   L2 differential fuzz: packages/domain's real evaluateRouting() against
   routing.reference.ts's independently-written naive evaluator (issue
   #605, part of the oracle-driven QA epic #418).

   The oracle for every assertion below is routing.reference.ts, never
   routing.ts read back at itself. Per qa-oracles.md §1: "Do not reuse the
   production code as its own oracle." Divergences are reported, not
   silently reconciled — a mismatch between the two is written out with
   both decisions so it is visible rather than averaged away.

   Only chains that validateRoutingChain accepts (`=== []`) are fuzzed
   against evaluation. Chains it rejects are a different contract (the
   save-time guard), not evaluation's — fuzzing evaluation on a chain the
   validator would already have refused to save tests a state that cannot
   occur in the running product, which is exactly the kind of ungrounded
   assertion qa-oracles.md §1 warns against ("without an oracle... manufactures
   confidence"). fast-check's filter() keeps generating until it finds an
   accepted chain, so coverage still exercises every acceptance path
   (single conditional-only chains, pure splits, interleaved splits,
   catch-all-last chains, condition-free single rules, etc).
   ============================================================ */

const COUNTRIES = ["US", "IN", "GB", "DE", "us", "in"] as const;
const LANGUAGES = ["en", "fr", "de", "hi", "EN", "FR"] as const;
const DEVICES: DeviceType[] = ["ios", "android", "desktop", "mobile"];

const arbCondition = fc.record(
  {
    country: fc.option(fc.constantFrom(...COUNTRIES), { nil: undefined }),
    device: fc.option(fc.constantFrom(...DEVICES), { nil: undefined }),
    language: fc.option(fc.constantFrom(...LANGUAGES), { nil: undefined }),
  },
  { requiredKeys: [] },
);

let idCounter = 0;
function nextId(): string {
  idCounter += 1;
  return `rule-${idCounter}`;
}

/** A conditional rule: at least one of country/device/language is set, no weight. */
const arbConditionalRule: fc.Arbitrary<RoutingRule> = arbCondition
  .filter((w) => w.country !== undefined || w.device !== undefined || w.language !== undefined)
  .chain((when) =>
    fc.webUrl().map((url) => ({
      id: nextId(),
      when,
      then: url as RoutingRule["then"],
      weight: null,
    })),
  );

/** An unweighted catch-all: no conditions, no weight. "Everything else." */
const arbUnweightedCatchAll: fc.Arbitrary<RoutingRule> = fc.webUrl().map((url) => ({
  id: nextId(),
  when: {},
  then: url as RoutingRule["then"],
  weight: null,
}));

/** One arm of a weighted split: no conditions, a positive weight. The actual
 *  numeric value is assigned afterward so a whole group's weights can be
 *  made to sum to exactly 100. */
const arbWeightedArmShape: fc.Arbitrary<Omit<RoutingRule, "weight">> = fc.webUrl().map((url) => ({
  id: nextId(),
  when: {},
  then: url as RoutingRule["then"],
}));

/** Build a weighted group of 2-4 arms whose weights sum to exactly 100. */
const arbWeightedGroup: fc.Arbitrary<RoutingRule[]> = fc
  .array(arbWeightedArmShape, { minLength: 2, maxLength: 4 })
  .chain((shapes) =>
    fc
      .array(fc.integer({ min: 1, max: 100 }), { minLength: shapes.length, maxLength: shapes.length })
      .map((rawWeights) => {
        const total = rawWeights.reduce((s, w) => s + w, 0);
        // Scale to sum to exactly 100 (validateRoutingChain requires this to
        // within 0.01). Give any leftover from rounding to the last arm.
        const scaled = rawWeights.map((w) => Math.round((w / total) * 10000) / 100);
        const sumSoFar = scaled.slice(0, -1).reduce((s, w) => s + w, 0);
        scaled[scaled.length - 1] = Math.round((100 - sumSoFar) * 100) / 100;
        return shapes.map((shape, i) => ({ ...shape, weight: scaled[i]! }));
      }),
  );

/**
 * Interleave two arrays using a boolean "take-left" pattern of the same
 * length as the combined output, so fast-check can shrink/vary exactly
 * where each weighted arm lands relative to the conditionals (immediately
 * before all of them, immediately after, or sandwiched between two) rather
 * than only ever appending the group at a fixed position.
 */
function interleave<T>(left: T[], right: T[], takeLeftPattern: boolean[]): T[] {
  const merged: T[] = [];
  let li = 0;
  let ri = 0;
  for (const takeLeft of takeLeftPattern) {
    if (takeLeft && li < left.length) {
      merged.push(left[li]!);
      li++;
    } else if (ri < right.length) {
      merged.push(right[ri]!);
      ri++;
    } else if (li < left.length) {
      merged.push(left[li]!);
      li++;
    }
  }
  while (li < left.length) merged.push(left[li++]!);
  while (ri < right.length) merged.push(right[ri++]!);
  return merged;
}

/**
 * A full chain: zero-or-more conditional rules, with either nothing else,
 * one unweighted catch-all appended last, or one weighted group whose arms
 * may be interleaved anywhere among the conditionals (including before,
 * after, or between them) — mirroring validateRoutingChain's documented
 * acceptance of an interleaved split.
 */
const arbAcceptedChain: fc.Arbitrary<RoutingRule[]> = fc
  .array(arbConditionalRule, { minLength: 0, maxLength: 4 })
  .chain((conditionals) =>
    fc.oneof(
      // No catch-all at all: falls through to the link's own fallback.
      fc.constant(conditionals),
      // One unweighted catch-all, always last.
      arbUnweightedCatchAll.map((catchAll) => [...conditionals, catchAll]),
      // A weighted group, interleaved among the conditionals at a
      // fast-check-chosen pattern of positions.
      arbWeightedGroup.chain((group) =>
        fc
          .array(fc.boolean(), { minLength: conditionals.length + group.length, maxLength: conditionals.length + group.length })
          .map((pattern) => interleave(conditionals, group, pattern)),
      ),
    ),
  );

const arbVisitorContext: fc.Arbitrary<VisitorContext> = fc.record({
  country: fc.option(fc.constantFrom(...COUNTRIES, "FR", "JP"), { nil: null }),
  device: fc.option(fc.constantFrom(...DEVICES), { nil: null }),
  language: fc.option(fc.constantFrom(...LANGUAGES, "ja"), { nil: null }),
  visitorHash: fc.string({ minLength: 1, maxLength: 32 }),
});

const SEED = 605_423;

describe("evaluateRouting agrees with an independent naive reference implementation", () => {
  it("matches destination and matchedRuleId on every accepted chain and visitor context fast-check can generate", () => {
    fc.assert(
      fc.property(
        arbAcceptedChain.filter((chain) => validateRoutingChain(chain).length === 0),
        arbVisitorContext,
        fc.webUrl(),
        (rules, ctx, fallback) => {
          const actual = evaluateRouting(rules, fallback, ctx);
          const expected = evaluateRoutingReference(rules, fallback, ctx);

          expect({ destination: actual.destination, matchedRuleId: actual.matchedRuleId }).toEqual({
            destination: expected.destination,
            matchedRuleId: expected.matchedRuleId,
          });
        },
      ),
      { numRuns: 500, seed: SEED },
    );
  });

  it("matches which weighted arm is picked (not just that some arm was) for pure-split chains", () => {
    // Narrower than the property above: restrict to chains that are a pure
    // weighted split (no conditionals at all) so every generated visitor
    // necessarily falls into the weighted group, exercising
    // chooseFromWeightedGroup / pickWeighted on every single run rather than
    // only on whichever fraction of the general property's draws happen to
    // miss every conditional.
    fc.assert(
      fc.property(arbWeightedGroup, arbVisitorContext, fc.webUrl(), (group, ctx, fallback) => {
        const actual = evaluateRouting(group, fallback, ctx);
        const expected = evaluateRoutingReference(group, fallback, ctx);
        expect(actual.matchedRuleId).toBe(expected.matchedRuleId);
        expect(actual.variant).toBe(expected.variant);
      }),
      { numRuns: 500, seed: SEED + 1 },
    );
  });

  it("agrees on the exact fixed-point case documented in routing.ts (interleaved split regression, #423)", () => {
    // Pins the specific shape the #423 regression test in routing.test.ts
    // already covers by hand, through the differential oracle instead of a
    // hand-picked expected value, so this layer's coverage includes the one
    // documented historical divergence class, not only freshly generated
    // shapes.
    const rules: RoutingRule[] = [
      { id: "a", when: {}, then: "https://a.example", weight: 50 },
      { id: "in", when: { country: "IN" }, then: "https://in.example", weight: null },
      { id: "b", when: {}, then: "https://b.example", weight: 50 },
    ];
    const ctxs: VisitorContext[] = [
      { country: "IN", device: "desktop", language: "en", visitorHash: "v1" },
      { country: "US", device: "desktop", language: "en", visitorHash: "v2" },
      { country: "US", device: "mobile", language: "en", visitorHash: "v3" },
      { country: null, device: null, language: null, visitorHash: "v4" },
    ];
    for (const ctx of ctxs) {
      const actual = evaluateRouting(rules, "https://fallback.example", ctx);
      const expected = evaluateRoutingReference(rules, "https://fallback.example", ctx);
      expect(actual).toEqual(expected);
    }
  });
});
