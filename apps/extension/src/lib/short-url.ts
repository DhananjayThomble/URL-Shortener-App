/* Pure helper: build the public short URL a link resolves at.
 *
 * The Link contract carries only `domain` and `slug`, never an absolute short
 * URL, so the extension has to synthesize one. The scheme is the tricky part:
 * hosted deployments serve redirects over https, but the self-hosting story
 * this extension goes out of its way to support defaults to `localhost:3002`
 * over http, and a hard-coded `https://` there yields an unreachable link.
 *
 * The scheme is derived rather than assumed:
 *  - When the link's domain host matches the configured API base URL's host,
 *    reuse that base URL's protocol. A self-hoster who points the extension at
 *    `http://localhost:3002` and shortens onto `localhost:3002` gets http back.
 *  - Otherwise fall back to a host heuristic: loopback hosts (localhost, its
 *    subdomains, 127.0.0.0/8, ::1) and any domain carrying an explicit port are
 *    treated as http; everything else as https.
 */

/** A configured origin whose protocol we can borrow when the host matches. */
export interface ShortUrlContext {
  apiBaseUrl?: string;
}

/** The pieces of a Link needed to build its public short URL. */
export interface ShortUrlLink {
  domain: string;
  slug: string;
}

function hostOf(domain: string): string {
  // `domain` is a bare host (optionally host:port), not a URL, so give it a
  // scheme to parse. The scheme chosen here is irrelevant; only the host is read.
  try {
    return new URL(`https://${domain}`).hostname.toLowerCase();
  } catch {
    return domain.toLowerCase();
  }
}

function isLoopbackHost(host: string): boolean {
  return (
    host === "localhost" ||
    host.endsWith(".localhost") ||
    host === "::1" ||
    host === "[::1]" ||
    /^127\.\d{1,3}\.\d{1,3}\.\d{1,3}$/.test(host)
  );
}

function hasExplicitPort(domain: string): boolean {
  // Ignore a bracketed IPv6 host's internal colons; only a `:port` suffix counts.
  const afterHost = domain.startsWith("[") ? domain.slice(domain.indexOf("]") + 1) : domain;
  return /:\d+$/.test(afterHost);
}

/** Decide http vs https for a short domain, borrowing the API base scheme on a host match. */
export function shortUrlScheme(domain: string, context: ShortUrlContext = {}): "http" | "https" {
  const base = context.apiBaseUrl?.trim();
  if (base) {
    try {
      const baseUrl = new URL(base);
      if (baseUrl.hostname.toLowerCase() === hostOf(domain)) {
        return baseUrl.protocol === "http:" ? "http" : "https";
      }
    } catch {
      /* malformed base URL; fall through to the host heuristic */
    }
  }

  const host = hostOf(domain);
  if (isLoopbackHost(host) || hasExplicitPort(domain)) return "http";
  return "https";
}

/** Build the absolute short URL for a link, deriving the scheme from its domain. */
export function buildShortUrl(link: ShortUrlLink, context: ShortUrlContext = {}): string {
  return `${shortUrlScheme(link.domain, context)}://${link.domain}/${link.slug}`;
}
