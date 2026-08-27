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
  if (country && country.toUpperCase() !== (ctx.country ?? "").toUpperCase()) return false;
  if (language && language.toLowerCase() !== (ctx.language ?? "").toLowerCase()) return false;

  if (device) {
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
  if (total <= 0) return rules[0]!;

  // Scale to 10,000 so weights of 33.33 behave.
  const point = bucketOf(seed, 10_000);
  let cumulative = 0;
  for (const rule of rules) {
    cumulative += ((rule.weight ?? 0) / total) * 10_000;
    if (point < cumulative) return rule;
  }
  return rules[rules.length - 1]!;
}

/**
 * Walk the chain, first match wins, and fall back to the link's own destination.
 *
 * Weighted rules are gathered as a group: if several catch-all rules carry
 * weights, they form one split rather than the first one always winning.
 */
export function evaluateRouting(
  rules: RoutingRule[],
  fallbackDestination: string,
  ctx: VisitorContext,
): RoutingDecision {
  const conditional = rules.filter((r) => !isCatchAll(r));
  const catchAll = rules.filter(isCatchAll);

  for (const rule of conditional) {
    if (matches(rule, ctx)) {
      return { destination: rule.then, matchedRuleId: rule.id, variant: null };
    }
  }

  const weighted = catchAll.filter((r) => typeof r.weight === "number" && r.weight > 0);
  if (weighted.length > 0) {
    const picked = pickWeighted(weighted, ctx.visitorHash);
    return {
      destination: picked.then,
      matchedRuleId: picked.id,
      variant: `${weighted.indexOf(picked) + 1}/${weighted.length}`,
    };
  }

  const plainCatchAll = catchAll.find((r) => !r.weight);
  if (plainCatchAll) {
    return { destination: plainCatchAll.then, matchedRuleId: plainCatchAll.id, variant: null };
  }

  return { destination: fallbackDestination, matchedRuleId: null, variant: null };
}

/**
 * Reject chains that cannot behave as the author expects. Called on save, so
 * the error surfaces in the drawer rather than in a visitor's browser.
 */
export function validateRoutingChain(rules: RoutingRule[]): string[] {
  const problems: string[] = [];

  const weighted = rules.filter(isCatchAll).filter((r) => typeof r.weight === "number" && r.weight > 0);
  if (weighted.length === 1) {
    problems.push("A split test needs at least two destinations to split between.");
  }
  if (weighted.length > 1) {
    const total = weighted.reduce((sum, r) => sum + (r.weight ?? 0), 0);
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
    const key = JSON.stringify([
      rule.when.country?.toUpperCase() ?? null,
      rule.when.device ?? null,
      rule.when.language?.toLowerCase() ?? null,
    ]);
    if (seen.has(key)) problems.push("Two rules have identical conditions — the second can never match.");
    seen.add(key);
  }

  return problems;
}
