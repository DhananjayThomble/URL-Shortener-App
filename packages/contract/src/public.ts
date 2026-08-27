import { z } from "zod";
import { RedirectType, SafeBrowsingStatus } from "./link.js";

/** The trust page at /p/[slug]. No auth — anyone can see where a link goes. */
export const PublicLinkPreview = z.object({
  shortUrl: z.string(),
  destination: z.string(),
  createdAt: z.string(),
  createdBy: z.string(),
  verifiedDomain: z.boolean(),
  safeBrowsing: SafeBrowsingStatus,
  scannedAt: z.string(),
  setsCookies: z.boolean(),
  redirectType: RedirectType,
});
export type PublicLinkPreview = z.infer<typeof PublicLinkPreview>;

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
