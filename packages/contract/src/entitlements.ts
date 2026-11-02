import { z } from "zod";

/* ============================================================
   Plan entitlements — the ONE place that says what a plan may do.

   #966 makes custom domains a paid-plan feature. Rather than scatter
   `if (plan === "Free")` checks across the API and the web, every
   per-plan limit lives here, keyed by plan name, with a single lookup
   (`entitlementsFor`). The API gates `POST /domains` on it and the web
   gates the Domains page on it, so the two can never disagree.

   #970 will make plan definitions editable from the admin panel. When it
   lands it replaces the static `PLAN_ENTITLEMENTS` table below with a
   DB-backed read, but keeps this module's shape and `entitlementsFor`
   signature — callers stay unchanged. This is deliberately the seam.
   ============================================================ */

/** What a plan is allowed to do. One object per plan; grows as features are
 *  gated. Keep every field a plain value (no functions) so #970 can store a
 *  row per plan and reconstruct this object from it. */
export const PlanEntitlements = z.object({
  /** May this plan connect its own custom domains at all? Free cannot; paid
   *  plans can. When false, `maxCustomDomains` is 0 and the Domains page shows
   *  an upgrade prompt instead of the add form. */
  customDomains: z.boolean(),
  /** How many custom domains this plan may have connected at once. 0 when
   *  `customDomains` is false. A finite cap even on paid plans so a single
   *  workspace can't connect an unbounded number; raise per plan as needed. */
  maxCustomDomains: z.number().int().min(0),
});
export type PlanEntitlements = z.infer<typeof PlanEntitlements>;

/* The free tier: the shared snapurl.in domain only, no custom domains. This is
   also the fallback for any plan name the table does not know (see
   `entitlementsFor`), so an unrecognised or operator-typo'd plan fails safe —
   it never silently grants a paid feature. */
export const FREE_ENTITLEMENTS: PlanEntitlements = {
  customDomains: false,
  maxCustomDomains: 0,
};

/* A generic paid tier: custom domains allowed, with a generous cap. Most non-
   Free plans resolve to this today. #970 will let an operator give each named
   plan its own row; until then one paid shape covers Pro/Team/Business/Growth/
   Agency and every other non-Free name an operator sets by hand. */
export const PAID_ENTITLEMENTS: PlanEntitlements = {
  customDomains: true,
  maxCustomDomains: 25,
};

/* The top tier. Custom domains allowed with a much larger cap than the generic
   paid tier — an Enterprise customer routinely connects far more domains than a
   Pro one, so the distinction is real, not a test convenience. #970 will make
   each tier's cap operator-editable; this is a sensible default until then. */
export const ENTERPRISE_ENTITLEMENTS: PlanEntitlements = {
  customDomains: true,
  maxCustomDomains: 1000,
};

/* Explicit, known plan definitions. Keys are compared case-insensitively
   (see `entitlementsFor`). "Free" is pinned restricted here so it is a
   deliberate decision rather than a fallthrough. The seeded paid keys
   (starter/pro/team/enterprise, matching #986's PLAN_KEYS plus enterprise) are
   listed so the set is self-documenting and matches the rows #970 seeds into
   the DB plans table. Any key NOT here resolves to Free — see entitlementsFor. */
export const PLAN_ENTITLEMENTS: Record<string, PlanEntitlements> = {
  free: FREE_ENTITLEMENTS,
  starter: PAID_ENTITLEMENTS,
  pro: PAID_ENTITLEMENTS,
  team: PAID_ENTITLEMENTS,
  enterprise: ENTERPRISE_ENTITLEMENTS,
};

/**
 * The entitlements for a workspace's plan — the single lookup every caller
 * uses. Never throws and never returns undefined.
 *
 * Resolution, in order:
 *   1. An empty / whitespace-only plan is the Free tier. A blank plan column
 *      must not accidentally unlock a paid feature.
 *   2. A name in `PLAN_ENTITLEMENTS` (case-insensitive, trimmed) uses its row.
 *   3. Any OTHER non-empty name resolves to the Free tier — FAIL CLOSED.
 *
 * #970 changes step 3 from #966's behaviour. Under #966 an unknown non-empty
 * name was treated as a generic paid tier, on the assumption an operator typed
 * a plan name by hand. With #970 the admin panel owns the plan catalogue: a
 * workspace's plan is an admin-assigned KEY that must exist in the plans table,
 * so a name that isn't a known key is a mistake (a typo, a deleted plan, a
 * stale value) and must NOT silently grant a paid feature. The DB-backed
 * resolver (@snapurl/contract resolveEntitlements + the API PlansService) is
 * the live path; this static lookup is the compile-time fallback the web and
 * the pure #966 custom-domains check still use, and it fails closed to match.
 */
export function entitlementsFor(plan: string | null | undefined): PlanEntitlements {
  const key = (plan ?? "").trim().toLowerCase();
  if (key === "") return FREE_ENTITLEMENTS;
  return PLAN_ENTITLEMENTS[key] ?? FREE_ENTITLEMENTS;
}

/** Convenience predicate for the one check #966 is about: may this plan add a
 *  custom domain? Reads at the call site as the question it answers. */
export function planAllowsCustomDomains(plan: string | null | undefined): boolean {
  return entitlementsFor(plan).customDomains;
}
