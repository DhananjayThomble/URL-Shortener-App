/* Pure helpers for the "Access" tab of the create/edit link drawers (issue #759).

   Three of that tab's switches gate inputs of their own:

     "Go live on a date"          -> Go live on (date), Until then send visitors to (URL)
     "Expire on a date"           -> Expiry date,       Then send visitors to (URL)
     "Expire after a click limit" -> Click limit

   Until #759 only the Click limit input followed its switch (disabled while off); the
   two dates and the two URLs stayed live, so one tab had two conventions. Now every
   gated input is disabled while its switch is off, shows ONE kind of hint
   (gateOffPlaceholder), and a value typed behind an off switch is neither sent nor able
   to block the save (dropUngatedUrls). A switch that is turned off and on again gives
   back what it had (switchGate), instead of a new default.

   Why the URL fields hang off the DATE switches and not off a switch of their own: the
   redirect only reads them for that block reason (apps/redirect/src/main.ts:
   `blocked === "scheduled"` -> scheduledTo, `blocked === "expired"` -> expiresTo). A click
   limit is its own gate ("click_limit"), which never reads expiresTo. */

export type AccessGate = "activatesAt" | "expiresAt" | "clickLimit";

/** The title of each gate's switch, as the user reads it. */
export const GATE_TITLES: Record<AccessGate, string> = {
  activatesAt: "Go live on a date",
  expiresAt: "Expire on a date",
  clickLimit: "Expire after a click limit",
};

/**
 * Placeholders of the two "send visitors to" inputs. They are examples of what to TYPE, so
 * each is a value the contract's HttpUrl guard accepts as it stands: with a scheme. (They
 * used to be `acme.com/coming-soon` / `acme.com/offers`, which the form then refused.)
 */
export const FALLBACK_URL_PLACEHOLDERS = {
  scheduledTo: "https://acme.com/coming-soon",
  expiresTo: "https://acme.com/offers",
} as const;

/** What a gated text input shows while its switch is off: which switch to turn on. */
export function gateOffPlaceholder(gate: AccessGate): string {
  return `Turn on "${GATE_TITLES[gate]}" above`;
}

/**
 * Is this gate's switch on, given the form value it controls? A date is on when it is set.
 * A click limit is on for ANY value but null/undefined — the field keeps what the user is
 * typing (even "" or "abc", see click-limit-input.ts), and an unfinished entry is not
 * "off": turning the switch off is how the limit is removed.
 */
export function isGateOn(gate: AccessGate, value: unknown): boolean {
  return gate === "clickLimit" ? value != null : Boolean(value);
}

export interface GateSwitch<T> {
  /** What the form should hold: null when the gate is off. */
  value: T | null;
  /** What to keep so switching the gate back on can give it back. */
  remembered: T | null;
}

/**
 * The result of clicking a gate's switch.
 *
 * Off: the value is null, and the value that was set is remembered (kept from an earlier
 * off, if the field holds nothing now). `canRestore` says whether a value is worth
 * remembering — a click limit that is not a valid limit is not.
 * On: the remembered value if there is one, otherwise `fallback` (the default for a gate
 * that has never been set).
 */
export function switchGate<T>(
  on: boolean,
  current: T | null | undefined,
  remembered: T | null | undefined,
  fallback: T,
  canRestore: (value: T) => boolean = () => true,
): GateSwitch<T> {
  if (on) return { value: remembered ?? fallback, remembered: null };
  const keep = current != null && canRestore(current) ? current : (remembered ?? null);
  return { value: null, remembered: keep };
}

/**
 * A "send visitors to" URL means nothing without the date that triggers it, so with the date
 * switched off it is not part of the link: it is not sent (on create) and it clears what the
 * link had (on edit, where undefined becomes null). It also can no longer fail validation —
 * junk typed there before the switch was turned off must not block a save for a field the
 * user cannot see in use.
 */
export function dropUngatedUrls<T extends { expiresAt?: unknown; activatesAt?: unknown; expiresTo?: unknown; scheduledTo?: unknown }>(
  values: T,
): T {
  return {
    ...values,
    expiresTo: isGateOn("expiresAt", values.expiresAt) ? values.expiresTo : undefined,
    scheduledTo: isGateOn("activatesAt", values.activatesAt) ? values.scheduledTo : undefined,
  };
}
