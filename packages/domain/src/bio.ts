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
  return `${webOrigin.replace(/\/+$/, "")}${bioPagePath(domain, slug)}`;
}
