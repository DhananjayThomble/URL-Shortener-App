/* Expiry-date rules shared by the API and the web drawers (#754).

   Its own module with no imports, and its own package subpath
   (`@snapurl/domain/expiry`), so the browser bundle can use it without pulling
   in the parts of this package that need Node (visitor hashing uses
   node:crypto) — the same reason `@snapurl/domain/routing` exists. */

function asDate(value: Date | string | null | undefined): Date | null {
  if (!value) return null;
  const date = value instanceof Date ? value : new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

/** What a link is told when its new expiry has already passed (#754). Shown verbatim by the API and the drawer. */
export const EXPIRY_IN_PAST_MESSAGE =
  "That expiry date has already passed, so the link would stop working straight away. Choose a later date, or remove the expiry.";

/**
 * How far behind "now" an expiry may be and still count as "now" rather than
 * "the past": one minute, enough to absorb a request in flight and a client
 * clock that runs slightly slow, far too little to backdate anything.
 */
export const EXPIRY_SKEW_TOLERANCE_MS = 60_000;

/**
 * Check that a NEW expiry has not already passed (#754).
 *
 * A link whose expiry is in the past is born expired: `deriveStatus` calls it
 * "expired" and every click gets the expired page. That is never what someone
 * filling in an expiry date meant, so it is refused on write, using exactly
 * `deriveStatus`'s boundary — an expiry at or before `now` is already expired.
 *
 * `previous` is the expiry the row already has, for edits. The same instant
 * again is not a new value and is never refused: a link that expired last week
 * must stay editable (the edit form sends every field back, the old expiry
 * included), and refusing it would lock the link. Only a *changed* expiry is
 * judged. Clearing the expiry (null) is always allowed, as is moving it into
 * the future.
 *
 * `toleranceMs` widens "now" backwards for callers that want to accept a value
 * meant as "right now" — the API passes EXPIRY_SKEW_TOLERANCE_MS on edit, where
 * "expire this now" is a legitimate thing to ask, and the web form passes it so
 * a slightly fast browser clock never flags a date the server would accept.
 * Create passes none: a brand-new link expiring "now" is born expired too.
 *
 * Returns the problems, empty when there are none — the same shape as
 * `validateSchedule`, so a caller can concatenate them and raise once. A value
 * that is not a date at all is not judged here; the contract refuses it.
 */
export function validateExpiry(
  expiresAt: Date | string | null | undefined,
  options: { now?: Date; previous?: Date | string | null; toleranceMs?: number } = {},
): string[] {
  const expires = asDate(expiresAt);
  if (!expires) return [];
  const previous = asDate(options.previous);
  if (previous && previous.getTime() === expires.getTime()) return [];
  const now = (options.now ?? new Date()).getTime();
  const tolerance = Math.max(0, options.toleranceMs ?? 0);
  return expires.getTime() <= now - tolerance ? [EXPIRY_IN_PAST_MESSAGE] : [];
}
