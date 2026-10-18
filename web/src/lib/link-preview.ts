import type { PublicLinkPreview } from "@snapurl/contract";

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
