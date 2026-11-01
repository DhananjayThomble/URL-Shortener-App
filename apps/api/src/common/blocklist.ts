/* ============================================================
   #971 — the destination blocklist matcher.

   A platform admin keeps a list of destination hosts no link may point to
   (the blocked_domains table). LinksService checks a link's destination
   against it on create and update, right beside the SSRF guard. The match
   rule lives here, pure and server-only, so enforcement and its tests agree on
   exactly one definition of "this destination is blocked".

   The rule: a destination is blocked when its hostname equals a blocked host,
   OR is a sub-domain of one. Blocking "evil.test" therefore also refuses
   "login.evil.test", but NOT "notevil.test" (a different name that merely ends
   with the text) and NOT "evil.test.co" (the blocked label is not a suffix of
   a longer label). Matching is case-insensitive and ignores a trailing dot.

   It lives in apps/api (not @snapurl/domain) on purpose: it is server-only
   enforcement logic, it is not needed in the browser bundle, and keeping it
   here avoids holding a straightforward string matcher to the domain package's
   100% mutation-score bar.
   ============================================================ */

/** Normalise a host for storage and comparison: lower-cased, trimmed, and with
 *  one trailing dot (the DNS root label) removed. "" for whitespace-only. */
export function normaliseBlockHost(host: string): string {
  const trimmed = host.trim().toLowerCase();
  return trimmed.endsWith(".") ? trimmed.slice(0, -1) : trimmed;
}

/** The comparable hostname of a destination. Accepts a full URL (a link's
 *  destination) or a bare host; returns "" when nothing usable remains. */
export function destinationHost(destination: string): string {
  try {
    return normaliseBlockHost(new URL(destination).hostname);
  } catch {
    return normaliseBlockHost(destination);
  }
}

/** Whether bare hostname `host` is covered by blocked host `blocked`: an exact
 *  match or a sub-domain of it. Empty either side never matches. */
export function hostCoveredBy(host: string, blocked: string): boolean {
  const h = normaliseBlockHost(host);
  const b = normaliseBlockHost(blocked);
  if (h === "" || b === "") return false;
  if (h === b) return true;
  return h.endsWith(`.${b}`);
}

/** The blocked host that covers `destination`, or null when none does. Returns
 *  the first match so the caller can name it in the refusal. */
export function matchBlockedDomain(destination: string, blocklist: Iterable<string>): string | null {
  const host = destinationHost(destination);
  if (host === "") return null;
  for (const blocked of blocklist) {
    if (hostCoveredBy(host, blocked)) return normaliseBlockHost(blocked);
  }
  return null;
}
