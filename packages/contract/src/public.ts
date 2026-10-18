import { z } from "zod";
import { RedirectType, SafeBrowsingStatus } from "./link.js";

/* #764 — what a visitor following the link actually gets, beside where it
   points. The preview said "This link is safe to open" with a Continue button
   for links the redirect answers with 410 (expired, click limit, archived) or
   404 (not live yet), because it carried no lifecycle at all.

   The state is the redirect's own verdict (`lifecycleGate` in
   @snapurl/domain), not the dashboard's `LinkStatus`: that one folds a reached
   click limit into "expired" and adds "expiring", and the difference matters
   here — only a date expiry can send visitors to a fallback page. A Safe
   Browsing flag is reported by `safeBrowsing`, as before. */
export const PublicLinkState = z.enum(["active", "expired", "click_limit", "scheduled", "archived"]);
export type PublicLinkState = z.infer<typeof PublicLinkState>;

/** The trust page at /p/[slug]. No auth — anyone can see where a link goes,
 *  unless the link has a password: the password is what guards the
 *  destination, so a protected link's preview carries `destination: null` and
 *  the only way through is the unlock flow below. */
export const PublicLinkPreview = z.object({
  shortUrl: z.string(),
  destination: z.string().nullable(),
  passwordProtected: z.boolean(),
  createdAt: z.string(),
  createdBy: z.string(),
  verifiedDomain: z.boolean(),
  safeBrowsing: SafeBrowsingStatus,
  scannedAt: z.string(),
  setsCookies: z.boolean(),
  redirectType: RedirectType,
  /* #764. These four are optional on purpose, for deploy skew: the web app
     parses this payload strictly, and a new web build talking to an API that
     predates them must still render (it treats absence as the old behaviour —
     active, no rules). The API always sends them. An old web build simply
     drops them, as zod strips unknown keys. */
  state: PublicLinkState.optional(),
  /** When the link stops (or stopped) working by date. Null when it has no expiry. */
  expiresAt: z.string().nullable().optional(),
  /** When the link starts working. Null when it has no start date. */
  activatesAt: z.string().nullable().optional(),
  /** The link has routing rules (country, device, language or a split), so a
   *  visitor may be sent somewhere other than `destination`. Only the fact,
   *  never the rules or where they point: those are a customer's campaign. */
  hasRules: z.boolean().optional(),
  /** In the expired or scheduled state: whether the owner set a page visitors
   *  are sent to instead. Never the fallback URL itself. False in every other
   *  state (a click limit and archiving have no fallback).
   *
   *  Null — not disclosed — for a password-protected link: whether its
   *  fallbacks sit behind the password is an open product decision (#802), so
   *  the preview says nothing about them either way. */
  hasFallback: z.boolean().nullable().optional(),
});
export type PublicLinkPreview = z.infer<typeof PublicLinkPreview>;

/* #762 — the unlock flow's own payload, for GET /public/links/:slug/lock.

   The redirect bounces a protected link to /p/<slug>?unlock=1, and the page
   used to need the preview above to draw the password form. The preview is
   refused when the owner turns public previews off, so those links could not be
   opened at all. The previews switch hides a link's metadata (creator, dates,
   scan state); it was never meant to switch the password off.

   So this is deliberately the minimum the form needs and nothing the switch
   hides: the short URL to send the visitor back through with a token, and
   whether a password guards it. Never the destination — that is what the
   password protects, before or after previews. */
export const PublicLinkLock = z.object({
  shortUrl: z.string(),
  passwordProtected: z.boolean(),
});
export type PublicLinkLock = z.infer<typeof PublicLinkLock>;

/* G3 — CreateLinkInput accepted a password and Link reported
   passwordProtected, but nothing let a visitor supply one.

   The unlock returns a short-lived token rather than the destination itself.
   Returning the destination would skip click recording, so password-protected
   links would report zero analytics. A cookie would break the "no cookies set"
   promise that is on the landing page, the settings screen and this very
   preview page. A token in the query string is visible in browser history,
   which is why it lives five minutes and is bound to one link id. */
export const UnlockLinkInput = z.object({ password: z.string().min(1) });
export type UnlockLinkInput = z.infer<typeof UnlockLinkInput>;

export const UnlockLinkResult = z.object({
  /** Append to the short URL as ?k=… */
  unlockToken: z.string(),
  expiresIn: z.number(),
});
export type UnlockLinkResult = z.infer<typeof UnlockLinkResult>;
