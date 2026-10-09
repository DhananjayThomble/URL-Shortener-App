import type { SafeBrowsingStatus } from "@snapurl/contract";

/* What the public trust page (/p/<slug>) says about a link's safety.
 *
 * It used to branch on `clean` vs everything else, so a link an operator had
 * flagged as phishing read exactly like one that had merely not been scanned
 * yet ("We couldn't fully verify this link", "Unverified"). Those are opposite
 * situations for the visitor: one is "we don't know", the other is "we were
 * told this is dangerous". Issue #647.
 *
 * `warningParam` is the redirect service's `?warning=unsafe`. It only ever
 * escalates: a flagged link whose status has not propagated to the preview
 * yet still reads as flagged, and the param can never make a link look safer. */
export type TrustState = {
  kind: "clean" | "flagged" | "unverified";
  heading: string;
  chipLabel: string;
  chipTone: "good" | "bad" | "warn";
  /** Icon glyph and its wash/ink classes. */
  icon: string;
  iconClass: string;
  /** Extra explanation under the heading, only when the link is flagged. */
  notice: string | null;
  continueLabel: "Continue to" | "Continue anyway to";
};

export function trustState(status: SafeBrowsingStatus, warningParam?: string | null): TrustState {
  if (status === "flagged" || warningParam === "unsafe") {
    return {
      kind: "flagged",
      heading: "This link has been flagged as unsafe",
      chipLabel: "Flagged as unsafe",
      chipTone: "bad",
      icon: "⚠",
      iconClass: "bg-wash-bad text-bad",
      notice:
        "This link was reported and flagged as potentially dangerous (for example phishing or malware). We recommend you do not continue.",
      continueLabel: "Continue anyway to",
    };
  }
  if (status === "clean") {
    return {
      kind: "clean",
      heading: "This link is safe to open",
      chipLabel: "No threats found",
      chipTone: "good",
      icon: "🛡",
      iconClass: "bg-wash-good text-good",
      notice: null,
      continueLabel: "Continue to",
    };
  }
  return {
    kind: "unverified",
    heading: "We couldn't fully verify this link",
    chipLabel: "Unverified",
    chipTone: "warn",
    icon: "🛡",
    iconClass: "bg-wash-warn text-amber",
    notice: null,
    continueLabel: "Continue to",
  };
}
