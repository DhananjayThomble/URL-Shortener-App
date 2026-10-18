import type { PublicLinkLock, PublicLinkPreview, PublicLinkState } from "@snapurl/contract";
import type { TrustState } from "./trust-state";

/* What the public trust page (/p/<slug>) may say about where a link goes.
 *
 * A password-protected link is "locked": its destination is never rendered and
 * there is no direct Continue link, because both handed the visitor the URL the
 * password exists to guard. The API already withholds the destination for these
 * (`destination: null`); `passwordProtected` is checked too, so a page can never
 * show a protected link as open even if a destination were somehow present. */
export type PreviewView = { kind: "locked" } | { kind: "open"; destination: string; host: string };

export function previewView(preview: Pick<PublicLinkPreview, "destination" | "passwordProtected">): PreviewView {
  if (preview.passwordProtected || preview.destination == null) return { kind: "locked" };
  let host = "the destination";
  try {
    host = new URL(preview.destination).hostname;
  } catch {
    /* keep the generic label for a destination that is not a parseable URL */
  }
  return { kind: "open", destination: preview.destination, host };
}

/* What the whole trust page shows (#762).
 *
 * The preview is refused (403) when the owner turned public previews off. The
 * page used to stop there, but the password form lived only in the preview's
 * success branch, so a protected link could not be opened at all — the
 * redirect's ?unlock=1 bounce landed on "That didn't load". The previews switch
 * hides metadata; it must not switch the password off.
 *
 * So on that 403 the page asks the lock route (PublicLinkLock), which is not
 * gated by the switch, and shows the bare password form when a password guards
 * the link. Anything else — no password, an unknown slug, or an older API with
 * no lock route — keeps the preview's own error. "lock" carries only the short
 * URL to come back through, whatever else a response might hold. */
export type TrustPage =
  | { kind: "loading" }
  | { kind: "preview" }
  | { kind: "lock"; shortUrl: string }
  | { kind: "error"; message: string };

type QueryState<T> = { pending: boolean; data?: T; error?: unknown };

/** The preview was refused because previews are off (the only 403 it sends). */
export function needsLockLookup(previewError: unknown): boolean {
  return (previewError as { status?: unknown } | null | undefined)?.status === 403;
}

export function trustPage(input: {
  preview: QueryState<PublicLinkPreview>;
  lock: QueryState<PublicLinkLock>;
}): TrustPage {
  const { preview, lock } = input;
  if (preview.data) return { kind: "preview" };
  if (!preview.error) return { kind: "loading" };
  const previewError = { kind: "error", message: (preview.error as Error).message } as const;
  if (!needsLockLookup(preview.error)) return previewError;
  if (lock.data?.passwordProtected) return { kind: "lock", shortUrl: lock.data.shortUrl };
  if (lock.pending && !lock.error) return { kind: "loading" };
  return previewError;
}

/** shortUrl is "domain/slug" with no scheme; localhost is the dev redirect. */
export function shortLinkUrl(shortUrl: string): URL {
  const scheme = /^(localhost|127\.0\.0\.1)/.test(shortUrl) ? "http" : "https";
  return new URL(/^https?:\/\//.test(shortUrl) ? shortUrl : `${scheme}://${shortUrl}`);
}

/* What the full preview says a visitor will get, and which controls it offers
 * (#764).
 *
 * The page used to decide from Safe Browsing alone, so it called an expired
 * link "safe to open" and offered Continue straight to a destination the
 * redirect would never send anyone to. This follows the redirect's own order
 * (apps/redirect/src/main.ts `gateFor`): archived, then a Safe Browsing flag,
 * then expired / click limit / not live yet, then the password.
 *
 * - A link that does not work replaces the safety heading with what is wrong,
 *   and offers no Continue to the destination — and no password form, since
 *   the redirect refuses the link before it ever checks a password.
 * - Where the owner set a fallback page (expired or not live yet), Continue
 *   goes back through the short link, so the redirect picks that page. The
 *   preview never learns its URL.
 * - With routing rules some visitors land somewhere else, so the page says so,
 *   and Continue goes through the short link to get the visitor the page the
 *   rules pick for them, rather than the default destination.
 *
 * An API that predates these fields (deploy skew) sends no `state`: that reads
 * as active with no rules, exactly the page as it was. */
export type PreviewOutcome = {
  state: PublicLinkState;
  /** Replaces the Safe Browsing heading when the link does not work. */
  blocked: { heading: string; icon: string; where: string } | null;
  continueTo: { href: string; label: string; muted: boolean } | null;
  passwordForm: boolean;
  rulesNote: string | null;
  dateRow: { label: "Expires" | "Expired" | "Goes live"; at: string } | null;
};

const RULES_NOTE =
  "This link has routing rules, so some visitors are sent to a different page — for example by country, device or language.";

function blockedCopy(state: Exclude<PublicLinkState, "active">, hasFallback: boolean | null | undefined) {
  switch (state) {
    case "archived":
      return { heading: "This link is no longer active", icon: "⏸", where: "Nowhere. The owner has archived this link." };
    case "click_limit":
      return {
        heading: "This link has reached its click limit",
        icon: "⏱",
        where: "Nowhere. The owner set it to stop after a number of clicks, and that number has been reached.",
      };
    case "expired":
      return {
        heading: "This link has expired",
        icon: "⏱",
        where:
          hasFallback === true
            ? "Now that it has expired, the owner sends visitors to a different page."
            : hasFallback === false
              ? "Nowhere. The link stopped working when it expired."
              : "It no longer goes to its destination.",
      };
    case "scheduled":
      return {
        heading: "This link isn't live yet",
        icon: "🗓",
        where:
          hasFallback === true
            ? "Until it goes live, the owner sends visitors to a different page."
            : hasFallback === false
              ? "Nowhere yet. It starts working when it goes live."
              : "It doesn't go to its destination until it goes live.",
      };
  }
}

export function previewOutcome(preview: PublicLinkPreview, trust: Pick<TrustState, "kind" | "continueLabel">): PreviewOutcome {
  const state: PublicLinkState = preview.state ?? "active";
  const view = previewView(preview);
  const viaShortLink = shortLinkUrl(preview.shortUrl).toString();
  const dateRow: PreviewOutcome["dateRow"] =
    state === "scheduled" && preview.activatesAt
      ? { label: "Goes live", at: preview.activatesAt }
      : state === "expired" && preview.expiresAt
        ? { label: "Expired", at: preview.expiresAt }
        : state === "active" && preview.expiresAt
          ? { label: "Expires", at: preview.expiresAt }
          : null;
  const none = { continueTo: null, passwordForm: false, rulesNote: null, dateRow } as const;

  // Archived beats everything, the flag included: the redirect answers 410.
  if (state === "archived") return { state, blocked: blockedCopy(state, false), ...none };

  /* Flagged: the redirect bounces every visit back here with a warning, before
     any other gate or the password. Going through the short link would loop,
     and so would the password form (#800). The only way on is the old
     "Continue anyway" straight to the destination, and only while the link
     itself still works. */
  if (trust.kind === "flagged") {
    if (state !== "active") return { state, blocked: blockedCopy(state, preview.hasFallback), ...none };
    return {
      state,
      blocked: null,
      ...none,
      continueTo:
        view.kind === "open" ? { href: view.destination, label: `${trust.continueLabel} ${view.host} →`, muted: true } : null,
      rulesNote: preview.hasRules ? RULES_NOTE : null,
    };
  }

  if (state !== "active") {
    // Only a date gate has a fallback; the redirect answers a click limit with 410.
    const fallback = state === "expired" || state === "scheduled" ? preview.hasFallback : false;
    return {
      state,
      blocked: blockedCopy(state, fallback),
      ...none,
      continueTo: fallback === true ? { href: viaShortLink, label: "Continue to the owner's page →", muted: false } : null,
    };
  }

  if (view.kind === "locked") return { state, blocked: null, ...none, passwordForm: true, rulesNote: preview.hasRules ? RULES_NOTE : null };

  return {
    state,
    blocked: null,
    ...none,
    rulesNote: preview.hasRules ? RULES_NOTE : null,
    continueTo: preview.hasRules
      ? { href: viaShortLink, label: `Continue to ${preview.shortUrl} →`, muted: false }
      : { href: view.destination, label: `${trust.continueLabel} ${view.host} →`, muted: false },
  };
}
