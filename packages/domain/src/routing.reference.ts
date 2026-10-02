import type { RoutingRule, DeviceType } from "@snapurl/contract";
import type { RoutingDecision, VisitorContext } from "./routing.js";

/* ============================================================
   An independent, deliberately naive reference oracle for routing-chain
   evaluation — written for the differential suite in
   routing.evaluate.differential.test.ts.

   Per .kiro/steering/qa-oracles.md §1: "write an independent, deliberately
   naive reference implementation and differential-test against it. Do not
   reuse the production code as its own oracle." This file does not import
   anything from routing.ts other than its *types* (VisitorContext,
   RoutingDecision — the declared payload shapes, not logic) and does not
   reuse any of its helper functions, control flow, or variable names. It is
   derived only from:

     - packages/contract/src/link.ts's docstring on RoutingRule: "First
       match wins."
     - routing.ts's own doc comment describing the weighted-catch-all
       grouping rule (an invariant validateRoutingChain enforces at save
       time, which evaluation must agree with by construction) — restated
       and reimplemented here from scratch, not copied.
     - The FNV-1a hash algorithm, a public, fully specified non-cryptographic
       hash (offset basis 0x811c9dc5, prime 0x01000193) — reimplemented here
       independently because the production code's choice of *which* bucket
       a given visitorHash falls into is a pinned deterministic algorithm,
       not an implementation detail open to reinterpretation. Two genuinely
       independent implementations of "hash this string with FNV-1a" must
       agree bit-for-bit on the output by definition of the algorithm; this
       is not the same as reusing routing.ts's bucketOf/pickWeighted *logic*
       for grouping, ordering or weight normalization, which is written
       fresh below using a different structural approach (collect-then-decide
       rather than skip-and-fallthrough-in-one-pass).

   Deliberately naive: no early-exit optimization, builds intermediate
   arrays rather than scanning once, recomputes conditions from scratch per
   rule. Correctness over performance — this is a test oracle, never a
   runtime path.
   ============================================================ */

function fnv1a(input: string): number {
  let hash = 0x811c9dc5;
  for (let i = 0; i < input.length; i++) {
    hash = hash ^ input.charCodeAt(i);
    // 32-bit unsigned multiply by the FNV prime, done in four 16-bit
    // partial products to avoid relying on Math.imul (a different
    // mechanical route to the same unsigned-32-bit result).
    const prime = 0x01000193;
    const low = hash & 0xffff;
    const high = hash >>> 16;
    const lowProduct = (low * prime) >>> 0;
    const highProduct = ((high * prime) << 16) >>> 0;
    hash = (lowProduct + highProduct) >>> 0;
  }
  return hash >>> 0;
}

function ruleHasAnyCondition(rule: RoutingRule): boolean {
  const w = rule.when;
  return Boolean(w.country) || Boolean(w.device) || Boolean(w.language);
}

function countrySatisfied(wanted: string | null | undefined, actual: string | null): boolean {
  if (!wanted) return true;
  if (!actual) return false;
  return wanted.toLowerCase() === actual.toLowerCase();
}

function languageSatisfied(wanted: string | null | undefined, actual: string | null): boolean {
  if (!wanted) return true;
  if (!actual) return false;
  return wanted.toLowerCase() === actual.toLowerCase();
}

/** The "mobile" device family covers ios and android as well as "mobile" itself. */
const MOBILE_FAMILY = new Set<DeviceType>(["mobile", "ios", "android"]);

function deviceSatisfied(wanted: DeviceType | null | undefined, actual: DeviceType | null): boolean {
  if (!wanted) return true;
  if (!actual) return false;
  if (wanted === "mobile") return MOBILE_FAMILY.has(actual);
  return wanted === actual;
}

function conditionsSatisfied(rule: RoutingRule, ctx: VisitorContext): boolean {
  return (
    countrySatisfied(rule.when.country, ctx.country) &&
    languageSatisfied(rule.when.language, ctx.language) &&
    deviceSatisfied(rule.when.device, ctx.device)
  );
}

/** A rule is part of the weighted split group iff it has no conditions and a positive weight. */
function isInWeightedGroup(rule: RoutingRule): boolean {
  return !ruleHasAnyCondition(rule) && typeof rule.weight === "number" && rule.weight > 0;
}

/**
 * Choose one member of the weighted group for this visitor.
 *
 * Builds a table of cumulative percentage boundaries (normalized against the
 * group's own weight total, mirroring how a pie chart's slices are laid out
 * end to end) and finds which slice a point in [0, 10000) falls into. The
 * point itself comes from hashing "<visitorHash>" with FNV-1a and reducing
 * modulo 10000 — a different reduction path than production's single
 * accumulator loop, but the same two public, fully specified operations
 * (FNV-1a, then modulo), so it must land in the same slice for the same
 * input by construction, not by replicated logic.
 */
function chooseFromWeightedGroup(group: RoutingRule[], visitorHash: string): { rule: RoutingRule; index: number } {
  const weightTotal = group.reduce((sum, r) => sum + (r.weight ?? 0), 0);
  if (weightTotal <= 0) return { rule: group[0]!, index: 0 };

  const boundaries: number[] = [];
  let runningTotal = 0;
  for (const r of group) {
    runningTotal += ((r.weight ?? 0) / weightTotal) * 10_000;
    boundaries.push(runningTotal);
  }

  const point = fnv1a(visitorHash) % 10_000;

  for (let i = 0; i < boundaries.length; i++) {
    if (point < boundaries[i]!) {
      return { rule: group[i]!, index: i };
    }
  }
  // Floating-point rounding could leave `point` just past the last boundary
  // (e.g. the last boundary computed as 9999.9999...); the last slice still
  // owns every remaining point, same tie-break production falls through to.
  return { rule: group[group.length - 1]!, index: group.length - 1 };
}

/**
 * Independent reference evaluator.
 *
 * Approach: collect every rule's classification up front (conditional vs.
 * weighted-catch-all vs. unweighted-catch-all), then decide in two
 * deliberate steps instead of one combined scan:
 *
 *   1. Walk the chain in author order. The first rule that is NOT part of
 *      the weighted group and whose conditions are satisfied — including an
 *      unweighted catch-all, whose "conditions" are vacuously satisfied —
 *      wins outright. This is "first match wins" read literally off the
 *      contract docstring, with the weighted group treated as transparent
 *      (skipped over) during this walk, exactly as routing.ts's own comment
 *      describes being required for validateRoutingChain's acceptance of an
 *      interleaved split to make sense.
 *   2. If step 1 found nothing, and the chain has a non-empty weighted
 *      group (gathered from anywhere in the chain, not just a contiguous
 *      run), the visitor is routed by chooseFromWeightedGroup.
 *   3. Otherwise, the link's own fallback destination.
 */
export function evaluateRoutingReference(
  rules: RoutingRule[],
  fallbackDestination: string,
  ctx: VisitorContext,
): RoutingDecision {
  const weightedGroup = rules.filter(isInWeightedGroup);

  for (const r of rules) {
    if (isInWeightedGroup(r)) continue;
    if (conditionsSatisfied(r, ctx)) {
      return { destination: r.then, matchedRuleId: r.id, variant: null };
    }
  }

  if (weightedGroup.length > 0) {
    const { rule, index } = chooseFromWeightedGroup(weightedGroup, ctx.visitorHash);
    return {
      destination: rule.then,
      matchedRuleId: rule.id,
      variant: `${index + 1}/${weightedGroup.length}`,
    };
  }

  return { destination: fallbackDestination, matchedRuleId: null, variant: null };
}
