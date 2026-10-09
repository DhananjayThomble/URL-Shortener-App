import type { Domain } from "@snapurl/contract";

/* #651 — which domain a "pick a domain" control starts on, and which ones it
   offers. One rule for every picker (new link, new bio page).

   The API refuses a link on a domain that is not `live` ("…isn't verified yet,
   so links on it wouldn't resolve", links.service.ts resolveDomain), so a
   picker that starts on `domains[0]` — a workspace's own, still-verifying
   domain sorts ahead of the shared one — sets the user up to fail. */

type DomainLike = Pick<Domain, "domain" | "status">;

/** Only a live domain resolves, so only a live domain can carry links. */
export function isUsableForLinks(d: Pick<Domain, "status">): boolean {
  return d.status === "live";
}

/** What the option reads as: a domain that is not live says so. */
export function domainOptionLabel(d: DomainLike): string {
  if (d.status === "live") return d.domain;
  return d.status === "failed" ? `${d.domain} — verification failed` : `${d.domain} — verifying`;
}

/**
 * The domain a picker should start on:
 *   1. the workspace's `defaultDomain`, if it is in the list and live;
 *   2. else the first live domain in list order (the shared, built-in domain is
 *      always live and always listed, so this exists in practice);
 *   3. else "" — never a verifying or failed domain. The caller leaves the
 *      field empty rather than pre-filling something that cannot work.
 */
export function defaultDomainFor(
  domains: readonly Domain[] | undefined,
  workspaceDefault: string | null | undefined,
): string {
  const live = (domains ?? []).filter(isUsableForLinks);
  const wanted = workspaceDefault?.toLowerCase();
  const preferred = wanted ? live.find((d) => d.domain.toLowerCase() === wanted) : undefined;
  return (preferred ?? live[0])?.domain ?? "";
}
