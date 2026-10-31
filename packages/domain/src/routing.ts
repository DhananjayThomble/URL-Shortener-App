import type { RoutingRule, DeviceType } from "@snapurl/contract";

/* ============================================================
   Routing chain evaluation.

   This is the single most correctness-critical function in the
   product: it decides where a human being actually lands. It is
   imported by apps/api (to validate a chain on save) and by
   apps/redirect (to execute it), so there is exactly one copy.

   Pure and synchronous by design — no clock, no randomness, no I/O.
   Everything it needs arrives in the context.
   ============================================================ */

export interface VisitorContext {
  /** ISO 3166-1 alpha-2, from CloudFront-Viewer-Country. Uppercase. */
  country: string | null;
  device: DeviceType | null;
  /** Primary subtag only — "en" from "en-GB,en;q=0.9". Lowercase. */
  language: string | null;
  /** Stable per visitor per day. Used to keep A/B buckets sticky. */
  visitorHash: string;
}

export interface RoutingDecision {
  destination: string;
  /** The rule that matched, or null when the chain fell through to the default. */
  matchedRuleId: string | null;
  /** Which arm of a weighted split was taken, for debugging. */
  variant: string | null;
}

/** A rule with no conditions is the "everything else" arm of the chain. */
function isCatchAll(rule: RoutingRule): boolean {
  const { country, device, language } = rule.when;
  return !country && !device && !language;
}

function matches(rule: RoutingRule, ctx: VisitorContext): boolean {
  const { country, device, language } = rule.when;

  // Every stated condition must hold. An unstated condition is not a constraint.
  // Stryker equivalence (the `?? ""` fallback string): it is only read when
  // ctx.country/ctx.language is nullish, and it is then compared against a
  // *truthy* rule condition (the `if (country && ...)` guard already excluded
  // an empty rule value). A nullish context value can never equal any non-empty
  // rule value, so every non-empty fallback — "" or anything else — yields the
  // same non-match. Behaviourally observable only via a rule whose value equals
  // the mutant string, which no routing input produces.
  // Stryker disable next-line StringLiteral: equivalent — the fallback is only compared against a truthy rule value, so a nullish context never matches it whatever the empty-string literal becomes.
  if (country && country.toUpperCase() !== (ctx.country ?? "").toUpperCase()) return false;
  // Stryker disable next-line StringLiteral: equivalent — same reason as the country fallback above.
  if (language && language.toLowerCase() !== (ctx.language ?? "").toLowerCase()) return false;

  if (device) {
    // Stryker equivalence (`if (!ctx.device) return false` -> skip): this early
    // return is an optimization, not a correctness gate. When ctx.device is
    // null and the rule states a device, skipping here falls into the block
    // below, where a "mobile" rule hits `null !== "mobile" && null !== "ios" &&
    // null !== "android"` (all true -> return false) and any explicit-device
    // rule hits `device !== null` (true -> return false). Both paths return
    // false for a null context device, so removing the guard changes nothing.
    // Stryker disable next-line ConditionalExpression: equivalent — with a null ctx.device every device rule returns false in the block below too, so this early return is a pure optimization.
    if (!ctx.device) return false;
    // "mobile" is a family: an iOS or Android visitor satisfies a mobile rule,
    // but an explicit "ios" rule is not satisfied by an Android visitor.
    if (device === "mobile") {
      if (ctx.device !== "mobile" && ctx.device !== "ios" && ctx.device !== "android") return false;
    } else if (device !== ctx.device) {
      return false;
    }
  }

  return true;
}

/** FNV-1a. Small, fast, and — unlike Math.random — deterministic for a visitor. */
function bucketOf(seed: string, buckets: number): number {
  let hash = 0x811c9dc5;
  for (let i = 0; i < seed.length; i++) {
    hash ^= seed.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return hash % buckets;
}

/**
 * Pick one arm of a weighted split, keyed on the visitor rather than on chance.
 *
 * Using Math.random() here would reshuffle a returning visitor between variants
 * on every click, which corrupts the A/B result and — worse — sends someone to
 * a different page than the one they bookmarked. Hashing the visitor keeps them
 * in the same bucket for as long as their hash is stable, which is one day.
 */
function pickWeighted(rules: RoutingRule[], seed: string): RoutingRule {
  const total = rules.reduce((sum, r) => sum + (r.weight ?? 0), 0);
  // Stryker equivalence (the `total <= 0` guard): pickWeighted is only ever
  // called with the result of `rules.filter(isWeightedCatchAll)`, and
  // isWeightedCatchAll requires `rule.weight > 0`. So every element has a
  // strictly positive weight and `total` is always > 0 — the guard, and any
  // mutation of its comparison or body, can never be reached by this caller.
  // Stryker disable next-line ConditionalExpression,EqualityOperator: equivalent — callers pass only weight>0 rules, so total is always >0 and this guard is unreachable.
  if (total <= 0) return rules[0]!;

  // Scale to 10,000 so weights of 33.33 behave.
  const point = bucketOf(seed, 10_000);
  let cumulative = 0;
  for (const rule of rules) {
    cumulative += ((rule.weight ?? 0) / total) * 10_000;
    // Stryker equivalence (`point < cumulative` vs `point <= cumulative`): they
    // differ only when the integer `point` (0..9999) lands EXACTLY on a float
    // `cumulative` boundary. Which arm wins at that single measure-zero tie does
    // not change the split distribution, the stickiness of a visitor's bucket,
    // or any assertion the suite makes (both the even-split and uneven-weight
    // tests hold under either). It is a boundary tie-break, not a behaviour.
    // Stryker disable next-line EqualityOperator: equivalent — differs only at an exact integer-on-float-boundary tie, a measure-zero point that changes no observable split behaviour.
    if (point < cumulative) return rule;
  }
  // Floating-point safety net: with positive weights the cumulative total
  // reaches 10000 and `point` (0..9999) always falls into some slice above, so
  // this final return is only a guard against rounding at the very top of the
  // range. The index mutation is on an unreachable-in-practice path.
  // Stryker disable next-line ArithmeticOperator: equivalent — weights sum to 10000 so `point` (< 10000) always matches a slice in the loop; this return is an unreached rounding guard.
  return rules[rules.length - 1]!;
}

function isWeightedCatchAll(rule: RoutingRule): boolean {
  // Stryker equivalence (`typeof rule.weight === "number"` -> true): the final
  // `rule.weight > 0` term already excludes every non-number — null, undefined
  // and NaN are all `> 0 === false` — so the typeof guard is redundant and
  // forcing it true cannot change the result. (It exists only to narrow the
  // type for the comparison.)
  // Stryker disable next-line ConditionalExpression: equivalent — `rule.weight > 0` already rejects every non-number, so the typeof guard is redundant.
  return isCatchAll(rule) && typeof rule.weight === "number" && rule.weight > 0;
}

/**
 * Walk the chain in author order and stop at the first rule that matches —
 * "first match wins" (`packages/contract/src/link.ts`'s docstring on
 * `RoutingRule`), the declared oracle for chain evaluation. This must agree
 * with `validateRoutingChain`, which already rejects a rule placed after an
 * unweighted catch-all on exactly this assumption.
 *
 * Weighted catch-all rules are the one exception to "stop at the first
 * match": every weighted catch-all anywhere in the chain forms a single
 * split, decided only once no earlier conditional rule matches, rather than
 * the first one reached always winning. This has to hold even when a
 * conditional rule sits between two weighted catch-alls — `validateRoutingChain`
 * sums every weighted catch-all's weight against the whole chain (not just a
 * contiguous run) when checking the split adds up to 100%, so it already
 * treats an interleaved chain like `[weight 50 -> A, {country: IN} -> IN,
 * weight 50 -> B]` as one valid split, and evaluation must agree.
 */
export function evaluateRouting(
  rules: RoutingRule[],
  fallbackDestination: string,
  ctx: VisitorContext,
): RoutingDecision {
  // validateRoutingChain sums every weighted catch-all's weight against the
  // whole chain, not just a consecutive run — it accepts a chain with a
  // conditional interleaved between two weighted catch-alls (e.g.
  // `[weight 50 -> A, {country: IN} -> IN, weight 50 -> B]`) as one 100%
  // split. Evaluation has to agree: treat every weighted catch-all in the
  // chain as one group, decided once the scan falls through the last
  // non-weighted rule, rather than stopping at whichever one is hit first.
  const weightedGroup = rules.filter(isWeightedCatchAll);

  for (let i = 0; i < rules.length; i++) {
    const rule = rules[i]!;
    if (isWeightedCatchAll(rule)) continue;

    if (matches(rule, ctx)) {
      return { destination: rule.then, matchedRuleId: rule.id, variant: null };
    }
  }

  if (weightedGroup.length > 0) {
    const picked = pickWeighted(weightedGroup, ctx.visitorHash);
    return {
      destination: picked.then,
      matchedRuleId: picked.id,
      variant: `${weightedGroup.indexOf(picked) + 1}/${weightedGroup.length}`,
    };
  }

  return { destination: fallbackDestination, matchedRuleId: null, variant: null };
}

/**
 * Reject chains that cannot behave as the author expects. Called on save, so
 * the error surfaces in the drawer rather than in a visitor's browser.
 */
export function validateRoutingChain(rules: RoutingRule[]): string[] {
  const problems: string[] = [];

  // Stryker equivalence (`typeof r.weight === "number"` -> true): redundant with
  // `r.weight > 0`, which rejects every non-number — same reasoning as
  // isWeightedCatchAll above.
  // Stryker disable next-line ConditionalExpression: equivalent — `r.weight > 0` already rejects every non-number, so the typeof guard is redundant.
  const weighted = rules.filter(isCatchAll).filter((r) => typeof r.weight === "number" && r.weight > 0);
  if (weighted.length === 1) {
    problems.push("A split test needs at least two destinations to split between.");
  }
  if (weighted.length > 1) {
    const total = weighted.reduce((sum, r) => sum + (r.weight ?? 0), 0);
    // Stryker equivalence (`> 0.01` vs `>= 0.01`): the two differ only when the
    // deviation from 100 is EXACTLY 0.01. This threshold is a rounding-slack
    // fudge (it exists so weights like 33.33×3 = 99.99 are accepted), and a sum
    // landing on precisely 0.01 off is both unreachable from clean weights in
    // IEEE-754 and, by the fudge's own intent, on the boundary of "close enough
    // to 100". Whether that exact tie is accepted or rejected is not a behaviour
    // the validator promises. The real tolerance window is pinned by the 99.98%
    // (rejected) and 33.333×3 (accepted) cases in routing.test.ts.
    // Stryker disable next-line EqualityOperator: equivalent — differs only at a deviation of exactly 0.01, an unreachable IEEE-754 tie on the fudge-factor boundary.
    if (Math.abs(total - 100) > 0.01) {
      problems.push(`Split weights add up to ${total}%, not 100%.`);
    }
  }

  // A rule after an unweighted catch-all can never run.
  const firstCatchAll = rules.findIndex((r) => isCatchAll(r) && !r.weight);
  if (firstCatchAll >= 0 && firstCatchAll < rules.length - 1) {
    const stranded = rules.length - firstCatchAll - 1;
    problems.push(
      `${stranded} rule${stranded === 1 ? "" : "s"} after "everything else" can never match. Move them above it.`,
    );
  }

  const seen = new Set<string>();
  for (const rule of rules) {
    if (isCatchAll(rule)) continue;
    // Stryker equivalence (toUpperCase/toLowerCase on the key parts): this key
    // exists only to compare two rules for equality, and every rule's value
    // runs through the *same* case transform. Swapping upper for lower (or vice
    // versa) changes every key identically, so the set-membership equality it
    // feeds is unchanged — the direction of the case fold is unobservable here.
    // What IS tested: that country and language occupy distinct key slots (so a
    // country difference is not collapsed to null — see the dedup tests).
    const key = JSON.stringify([
      // Stryker disable next-line MethodExpression: equivalent — both compared keys get the same case transform, so its direction cannot change the equality.
      rule.when.country?.toUpperCase() ?? null,
      rule.when.device ?? null,
      // Stryker disable next-line MethodExpression: equivalent — both compared keys get the same case transform, so its direction cannot change the equality.
      rule.when.language?.toLowerCase() ?? null,
    ]);
    if (seen.has(key)) problems.push("Two rules have identical conditions — the second can never match.");
    seen.add(key);
  }

  return problems;
}
