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

/** Why the redirect refuses to send a visitor to a link's destination. */
export type LifecycleGate = "archived" | "expired" | "click_limit" | "scheduled";

/** Every gate the redirect applies before it will route a visitor, flagged
 *  included. `null` means the link is live and a visitor reaches routing. */
export type EffectiveGate = "archived" | "flagged" | LifecycleGate;

/**
 * The FULL gate order the redirect applies, flagged included — the single
 * source of truth for "what does a visitor get" (#764).
 *
 * It mirrors `apps/redirect/src/main.ts` exactly: archived, then a Safe
 * Browsing flag, then the lifecycle gates below. The order is load-bearing and
 * the reason this lives in one place: a flagged link that is ALSO expired is
 * bounced to the warning page before any lifecycle fallback is consulted and
 * before routing rules run, so the preview must say "flagged", not "expired",
 * and must not promise a fallback or that rules may send the visitor
 * elsewhere. Getting that precedence wrong is exactly the compound-state bug
 * the public preview had.
 *
 * `safeBrowsingStatus` is read loosely (any value, "flagged" is the only one
 * that gates) so both the redirect's resolved link and the API row fit.
 */
export function effectiveGate(
  link: {
    archived: boolean;
    safeBrowsingStatus?: string | null;
    expiresAt?: Date | string | null;
    activatesAt?: Date | string | null;
    clickLimit?: number | null;
    clicks?: number;
  },
  now: Date = new Date(),
): EffectiveGate | null {
  if (link.archived) return "archived";
  if (link.safeBrowsingStatus === "flagged") return "flagged";
  return lifecycleGate(link, now);
}

/**
 * The same precedence as `effectiveGate`, but from parts a caller has ALREADY
 * derived: `flagged`, and the lifecycle verdict (the result of `lifecycleGate`,
 * or `null`/`"active"` for a live link). The public preview uses this: the API
 * sends it the lifecycle `state` and the Safe Browsing flag separately, and
 * this folds them in the redirect's order (archived > flagged > lifecycle)
 * without re-deriving anything from dates. One ordering, two entry points.
 */
export function effectiveGateFromState(
  flagged: boolean,
  lifecycle: LifecycleGate | "active" | null | undefined,
): EffectiveGate | null {
  if (lifecycle === "archived") return "archived";
  if (flagged) return "flagged";
  return lifecycle && lifecycle !== "active" ? lifecycle : null;
}

/**
 * The LIFECYCLE gates only (no archived-first, no flagged), in the redirect's
 * order. Kept separate from `effectiveGate` because the redirect checks
 * archived and the Safe Browsing flag itself before delegating here, and the
 * API reports the lifecycle state and a flagged link's safeBrowsing field
 * independently.
 *
 * Not `deriveStatus`: that is the dashboard's label, which folds a reached
 * click limit into "expired" and adds "expiring". This is what a visitor
 * actually gets.
 */
export function lifecycleGate(link: {
  archived: boolean;
  expiresAt?: Date | string | null;
  activatesAt?: Date | string | null;
  clickLimit?: number | null;
  clicks?: number;
}, now: Date = new Date()): LifecycleGate | null {
  if (link.archived) return "archived";
  const expires = asDate(link.expiresAt);
  if (expires && expires.getTime() <= now.getTime()) return "expired";
  /* The count is the last rollup's, so a hard cap can be overshot by a
     handful under concurrency (see the redirect's own note). */
  if (link.clickLimit != null && (link.clicks ?? 0) >= link.clickLimit) return "click_limit";
  const activates = asDate(link.activatesAt);
  if (activates && activates.getTime() > now.getTime()) return "scheduled";
  return null;
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
