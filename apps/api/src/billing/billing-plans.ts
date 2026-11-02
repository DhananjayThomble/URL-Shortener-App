import type { BillingInterval, PaidPlanKey } from "@snapurl/contract";

/* ============================================================
   #986 — resolving a (plan key, interval) pair to a provider plan id.

   A plan's PRICE lives at the provider, and #970/#987 make the catalogue and
   prices editable later, so the code here never carries an amount — it only
   maps the stable KEY + interval to the provider's plan id, read from config.

   RAZORPAY_PLAN_IDS is a comma-separated list of `planKey:interval=providerPlanId`
   pairs, e.g. "pro:monthly=plan_ABC,pro:yearly=plan_DEF,team:monthly=plan_GHI".
   An unconfigured (key, interval) resolves to undefined, which the provider
   turns into a clean "that plan is not available" rather than a provider error.
   ============================================================ */

/** The parsed catalogue: `${planKey}:${interval}` → provider plan id. */
export type PlanIdMap = Map<string, string>;

/** Build the lookup key for a (plan key, interval) pair. */
export function planLookupKey(planKey: PaidPlanKey, interval: BillingInterval): string {
  return `${planKey}:${interval}`;
}

/**
 * Parse RAZORPAY_PLAN_IDS into a map. Tolerant of surrounding whitespace and a
 * trailing comma; silently drops a malformed entry (no `=`, or an empty key or
 * id) rather than throwing, so one bad pair cannot stop the API booting — the
 * affected plan simply resolves to undefined and is reported unavailable.
 */
export function parsePlanIds(value: string | undefined): PlanIdMap {
  const map: PlanIdMap = new Map();
  if (!value) return map;
  for (const pair of value.split(",")) {
    const trimmed = pair.trim();
    if (trimmed === "") continue;
    const eq = trimmed.indexOf("=");
    if (eq <= 0) continue;
    const key = trimmed.slice(0, eq).trim();
    const id = trimmed.slice(eq + 1).trim();
    if (key === "" || id === "") continue;
    map.set(key, id);
  }
  return map;
}

/** Resolve a provider plan id for a (plan key, interval) pair, or undefined when
 *  it is not configured. */
export function resolvePlanId(
  map: PlanIdMap,
  planKey: PaidPlanKey,
  interval: BillingInterval,
): string | undefined {
  return map.get(planLookupKey(planKey, interval));
}
