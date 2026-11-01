import { entitlementsFor } from "@snapurl/contract";

/**
 * Whether the current workspace's plan may connect its own custom domains
 * (#966). Thin wrapper over the contract's `entitlementsFor` — the ONE source
 * of plan entitlements, shared with the API — so the Domains page offers the
 * add form only when `POST /domains` would accept it.
 *
 * `undefined` plan (the session still loading) is treated as not-allowed: the
 * page shows nothing paid until it knows the plan, rather than flashing an add
 * form it may have to take away.
 */
export function canAddCustomDomain(plan: string | undefined): boolean {
  if (plan === undefined) return false;
  return entitlementsFor(plan).customDomains;
}
