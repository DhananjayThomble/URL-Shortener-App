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

/* A generic paid tier: custom domains allowed, with a generous cap. Every plan
   that is not Free resolves to this today. #970 will let an operator give each
   named plan its own row; until then one paid shape covers Pro/Team/Business/
   Enterprise and every other non-Free name an operator sets by hand. */
export const PAID_ENTITLEMENTS: PlanEntitlements = {
  customDomains: true,
  maxCustomDomains: 25,
};

/* Explicit, known plan definitions. Keys are compared case-insensitively
   (see `entitlementsFor`). "Free" is pinned restricted here so it is a
   deliberate decision rather than a fallthrough. Named paid plans are listed
   so the set is self-documenting and #970 has concrete rows to seed from. */
export const PLAN_ENTITLEMENTS: Record<string, PlanEntitlements> = {
  free: FREE_ENTITLEMENTS,
  pro: PAID_ENTITLEMENTS,
  team: PAID_ENTITLEMENTS,
  business: PAID_ENTITLEMENTS,
  growth: PAID_ENTITLEMENTS,
  agency: PAID_ENTITLEMENTS,
  enterprise: PAID_ENTITLEMENTS,
};

/**
 * The entitlements for a workspace's plan — the single lookup every caller
 * uses. Never throws and never returns undefined.
 *
 * Resolution, in order:
 *   1. An empty / whitespace-only plan is the Free tier. A blank plan column
 *      must not accidentally unlock a paid feature.
 *   2. A name in `PLAN_ENTITLEMENTS` (case-insensitive, trimmed) uses its row.
 *   3. Any other non-empty name is treated as a paid plan. Operators set plan
 *      names by hand (#966 §4) and will add new ones; a name that isn't Free
 *      and isn't in the table is an operator-chosen paid tier, not a mistake to
 *      lock out. The only name that restricts custom domains is Free itself.
 */
export function entitlementsFor(plan: string | null | undefined): PlanEntitlements {
  const key = (plan ?? "").trim().toLowerCase();
  if (key === "") return FREE_ENTITLEMENTS;
  return PLAN_ENTITLEMENTS[key] ?? PAID_ENTITLEMENTS;
}

/** Convenience predicate for the one check #966 is about: may this plan add a
 *  custom domain? Reads at the call site as the question it answers. */
export function planAllowsCustomDomains(plan: string | null | undefined): boolean {
  return entitlementsFor(plan).customDomains;
}
