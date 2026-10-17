/**
 * The marketing hero's "paste a URL, press Shorten" box (#660).
 *
 * The landing page's Shorten control used to be a plain <Link href="/register">
 * that threw the pasted URL away: a visitor typed their destination, clicked,
 * and arrived at an empty sign-up form. These helpers carry that URL through
 * registration / sign-in and into the create-link drawer instead.
 *
 * Kept pure (no React, no router) so the validation and the exact target path
 * are unit-testable without a browser, and so the one place that builds the
 * `/links?new=…` deep link is the one place `/links` reads it back.
 */

/** The query param the hero writes and /links reads to prefill the drawer. */
export const NEW_LINK_QUERY_PARAM = "new";

/**
 * Is this a plausible http(s) URL to shorten?
 *
 * Deliberately permissive — the API's CreateLinkInput is the real validator and
 * returns a precise message. This only rejects what is obviously not a web URL
 * so the visitor gets an instant inline hint instead of a round-trip through
 * sign-up to a server error. A bare host like "acme.com" is accepted and left
 * for the drawer/API to normalise; only an explicit non-http(s) scheme
 * (javascript:, mailto:, ftp:) or something with no host at all is refused.
 */
export function isPlausibleHttpUrl(raw: string): boolean {
  const value = raw.trim();
  if (!value) return false;

  // An explicit scheme must be http(s). new URL() accepts javascript:, mailto:,
  // data: and the like, which are never something we can shorten.
  if (/^[a-z][a-z0-9+.-]*:/i.test(value)) {
    try {
      const url = new URL(value);
      return (url.protocol === "http:" || url.protocol === "https:") && Boolean(url.hostname);
    } catch {
      return false;
    }
  }

  // No scheme: treat it as a host-first URL (what a visitor pastes most often,
  // e.g. "acme.com/sale"). It is plausible if it parses with https:// prepended
  // AND the first segment looks like a hostname (has a dot, no spaces).
  const host = value.split(/[/?#]/, 1)[0];
  if (!host.includes(".") || /\s/.test(host)) return false;
  try {
    const url = new URL(`https://${value}`);
    return Boolean(url.hostname) && url.hostname.includes(".");
  } catch {
    return false;
  }
}

/**
 * Where the Shorten button should send the visitor.
 *
 * Signed in  → straight to the drawer: `/links?new=<encoded url>`.
 * Signed out → sign up first, carrying the drawer deep link as `next` so the
 *   visitor lands on it once their workspace exists:
 *   `/register?next=<encoded /links?new=<encoded url>>`.
 *
 * The URL is encoded once for the `?new=` param, and the whole `/links?new=…`
 * path is encoded again as the `?next=` value — the two layers safe-next
 * (web/src/lib/safe-next.ts) decodes on the way back in. This builds the path
 * only; it does not reimplement next handling.
 */
export function heroShortenTarget(rawUrl: string, isSignedIn: boolean): string {
  const url = rawUrl.trim();
  const drawerPath = `/links?${NEW_LINK_QUERY_PARAM}=${encodeURIComponent(url)}`;
  if (isSignedIn) return drawerPath;
  return `/register?next=${encodeURIComponent(drawerPath)}`;
}
