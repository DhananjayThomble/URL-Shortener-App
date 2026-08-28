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

/** Accepts what the database and the API both hand it, without either converting. */
function asDate(value: Date | string | null | undefined): Date | null {
  if (!value) return null;
  const date = value instanceof Date ? value : new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

/**
 * Derive the status the dashboard shows.
 *
 * None of these are stored. "expiring" means "this will expire within seven
 * days and you probably want to know"; "scheduled" means "this does not work
 * yet". Computing both rather than storing them means neither can go stale,
 * and — the point of the scheduled case — that a link set to go live on Friday
 * goes live on Friday with nothing having to run.
 *
 * The order matters where two could apply at once:
 *
 * - **archived** first, because it is the one state a person set by hand.
 * - **expired** before **scheduled**, because "will never work" is a more
 *   useful thing to be told than "does not work yet". A link whose window has
 *   already closed before it opened is a mistake, and the API rejects it on
 *   write, but a row can still get there by having its expiry brought forward.
 * - **scheduled** before **expiring**, because a link that is not live yet is
 *   not usefully described by how soon it will stop being live.
 */
export function deriveStatus(link: {
  archivedAt?: Date | string | null;
  expiresAt?: Date | string | null;
  activatesAt?: Date | string | null;
  clickLimit?: number | null;
  clicks?: number;
}, now: Date = new Date()): LinkStatus {
  if (link.archivedAt) return "archived";

  if (link.clickLimit != null && (link.clicks ?? 0) >= link.clickLimit) return "expired";

  const expires = asDate(link.expiresAt);
  if (expires && expires.getTime() <= now.getTime()) return "expired";

  const activates = asDate(link.activatesAt);
  if (activates && activates.getTime() > now.getTime()) return "scheduled";

  if (expires) {
    const sevenDays = 7 * 24 * 60 * 60 * 1000;
    if (expires.getTime() - now.getTime() <= sevenDays) return "expiring";
  }

  return "active";
}

/**
 * Check that a link's live window makes sense.
 *
 * Returns the problems, empty when there are none — the same shape as
 * `validateRoutingChain`, so a caller can concatenate them and raise once.
 *
 * There is only one rule, and it is worth enforcing rather than leaving to
 * `deriveStatus` to describe afterwards: a window that closes before it opens
 * means a link that can never work. `deriveStatus` reports that honestly as
 * "expired", but by then someone has already printed the QR code.
 *
 * A start date in the past is deliberately allowed. It reads as "this went
 * live then", it is what editing an old link naturally produces, and refusing
 * it would make the field unusable the moment the clock passes a value the
 * form was opened with.
 */
export function validateSchedule(
  activatesAt: Date | string | null | undefined,
  expiresAt: Date | string | null | undefined,
): string[] {
  const activates = asDate(activatesAt);
  const expires = asDate(expiresAt);
  if (activates && expires && activates.getTime() >= expires.getTime()) {
    return ["A link cannot be scheduled to start after it expires."];
  }
  return [];
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
