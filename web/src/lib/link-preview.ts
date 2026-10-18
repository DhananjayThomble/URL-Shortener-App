import type { PublicLinkLock, PublicLinkPreview } from "@snapurl/contract";

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
