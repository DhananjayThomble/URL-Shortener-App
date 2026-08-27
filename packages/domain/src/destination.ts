import type { LinkStatus, RedirectType } from "@snapurl/contract";

/* Turning a matched rule into the URL the visitor actually receives. */

export interface DestinationOptions {
  destination: string;
  /** The query string that arrived on the short link, without the "?". */
  incomingQuery?: string | null;
  forwardQuery: boolean;
  utm?: {
    source?: string | null;
    medium?: string | null;
    campaign?: string | null;
    content?: string | null;
  } | null;
}

/**
 * Compose the final URL.
 *
 * Precedence is deliberate: a parameter that arrived on the short link wins
 * over the link's stored UTM values. Someone who appends `?utm_source=x` to a
 * link is making a decision at click time, and silently overwriting it would
 * make campaign tracking lie.
 */
export function buildDestination(opts: DestinationOptions): string {
  let url: URL;
  try {
    url = new URL(opts.destination);
  } catch {
    // Stored destinations are validated on write; this is a last resort.
    return opts.destination;
  }

  if (opts.utm) {
    const pairs: Array<[string, string | null | undefined]> = [
      ["utm_source", opts.utm.source],
      ["utm_medium", opts.utm.medium],
      ["utm_campaign", opts.utm.campaign],
      ["utm_content", opts.utm.content],
    ];
    for (const [key, value] of pairs) {
      if (value) url.searchParams.set(key, value);
    }
  }

  if (opts.forwardQuery && opts.incomingQuery) {
    const incoming = new URLSearchParams(opts.incomingQuery);
    for (const [key, value] of incoming) {
      if (key === "k") continue; // the unlock token is ours, not the destination's
      url.searchParams.set(key, value);
    }
  }

  return url.toString();
}

/**
 * Derive the status the dashboard shows.
 *
 * "expiring" is a UI affordance rather than a stored state — it means "this
 * will expire within seven days and you probably want to know". Computing it
 * rather than storing it means it can never go stale.
 */
export function deriveStatus(link: {
  archivedAt?: Date | string | null;
  expiresAt?: Date | string | null;
  clickLimit?: number | null;
  clicks?: number;
}, now: Date = new Date()): LinkStatus {
  if (link.archivedAt) return "archived";

  if (link.clickLimit != null && (link.clicks ?? 0) >= link.clickLimit) return "expired";

  if (link.expiresAt) {
    const expires = link.expiresAt instanceof Date ? link.expiresAt : new Date(link.expiresAt);
    if (!Number.isNaN(expires.getTime())) {
      if (expires.getTime() <= now.getTime()) return "expired";
      const sevenDays = 7 * 24 * 60 * 60 * 1000;
      if (expires.getTime() - now.getTime() <= sevenDays) return "expiring";
    }
  }

  return "active";
}

/**
 * A 301 is cached by browsers indefinitely and cannot be recalled.
 *
 * The product's central promise is "print it once, change where it points
 * forever". A 301 breaks that promise for everyone who already clicked: their
 * browser never asks us again, so a destination edit never reaches them. This
 * is why the contract defaults to 302, and why every 302 we send carries
 * no-store.
 */
export function cacheHeadersFor(redirectType: RedirectType): Record<string, string> {
  if (redirectType === "301") {
    // The author explicitly chose permanence. Honour it, but don't extend it.
    return { "Cache-Control": "public, max-age=300" };
  }
  return { "Cache-Control": "no-store, no-cache, must-revalidate", Pragma: "no-cache" };
}

export const REDIRECT_STATUS: Record<RedirectType, 301 | 302 | 307> = {
  "301": 301,
  "302": 302,
  "307": 307,
};
