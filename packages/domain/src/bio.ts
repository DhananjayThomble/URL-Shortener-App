/* #650 — per-domain bio pages, served via a managed link.

   A published bio page at (domain, slug) owns a link at `<domain>/<slug>`
   whose destination is the web app's `/b/<domain>/<slug>`. A visitor hitting
   the short URL gets one 302 from the redirect service to the web host, which
   renders the page. The redirect service, the Dynamo projection, the cache and
   the edge KVS stay untouched — a managed link is just a link.

   These are the single source of truth for both shapes, so the publish path
   (apps/api BioPagesService) and the backfill one-off agree by construction. */

/** The web-app path that renders a bio page for an explicit (domain, slug).
 *  Both segments are URL-encoded: a domain is a hostname (dots are safe) and a
 *  slug is `[A-Za-z0-9._-]`, but encoding keeps a future looser slug honest. */
export function bioPagePath(domain: string, slug: string): string {
  return `/b/${encodeURIComponent(domain)}/${encodeURIComponent(slug)}`;
}

/** The absolute destination a managed bio link points at: the web origin plus
 *  the per-domain bio path. `webOrigin` is the API's WEB_ORIGIN (no trailing
 *  slash expected, but one is tolerated). */
export function bioManagedDestination(webOrigin: string, domain: string, slug: string): string {
  // Trim trailing slashes with a scan, not `/\/+$/`, which backtracks
  // quadratically on a long run of slashes that is not at the end.
  let end = webOrigin.length;
  // Stryker equivalence: neither `end > 0` -> `end >= 0` nor `end > 0` -> `true`
  // is observable. At end === 0 the second operand is webOrigin.charCodeAt(-1),
  // which is NaN, and NaN === 47 is false, so the loop stops at end === 0 under
  // every one of those forms. Covered by the "///" and "" cases in bio.test.ts.
  // Stryker disable next-line EqualityOperator,ConditionalExpression: equivalent — charCodeAt(-1) is NaN so the `=== 47` operand halts the loop at end===0 regardless of the first operand's form.
  while (end > 0 && webOrigin.charCodeAt(end - 1) === 47) end--;
  return `${webOrigin.slice(0, end)}${bioPagePath(domain, slug)}`;
}
