/* ============================================================
   #993 — the disposable-email matcher.

   Sign-up is refused from a known throwaway-email provider. The list of such
   domains is TWO sources folded together:
     • a maintained list vendored with the build (disposable-email-domains.ts,
       generated from the public `disposable-email-domains` project — see that
       file's header for licence and the update note);
     • an operator's own additions, held in platform settings
       (disposableEmails.extraDomains), for a new provider that appears before
       the vendored list catches it.

   The match rule reuses the blocklist's host-coverage semantics (hostCoveredBy):
   an email's domain is refused when it EQUALS a listed domain or is a SUB-DOMAIN
   of one. So listing "mailinator.com" also refuses "x.mailinator.com" (the
   providers hand out throwaway sub-domains), but not "notmailinator.com".

   Server-only, like blocklist.ts, and for the same reasons: it is enforcement
   logic, it is never needed in the browser bundle, and it is kept out of
   @snapurl/domain so a plain string matcher need not meet that package's 100%
   mutation bar.
   ============================================================ */

import { hostCoveredBy, normaliseBlockHost } from "./blocklist.js";

/** The domain part of an email address, lower-cased and trimmed, or "" when the
 *  input has no single `@` with a non-empty right-hand side. Splits on the LAST
 *  `@` so a quoted local-part containing one (`"a@b"@host`) still yields the
 *  real host — rare, but a wrong split here would let a crafted address dodge
 *  the check. */
export function emailDomain(email: string): string {
  const at = email.lastIndexOf("@");
  if (at <= 0 || at === email.length - 1) return "";
  return normaliseBlockHost(email.slice(at + 1));
}

/** Whether `host` (a bare, already-normalised email host) is covered by any
 *  entry in `list` — an exact match or a sub-domain of one. Exported so a
 *  caller (the mail-domain check) can skip a DNS lookup for an allow-listed
 *  host without re-implementing the coverage rule. */
export function hostCoveredByAny(host: string, list: Iterable<string>): boolean {
  for (const listed of list) {
    if (hostCoveredBy(host, listed)) return true;
  }
  return false;
}

/** Whether `email`'s domain is a disposable one under `domains` (the vendored
 *  list and the operator's additions, already concatenated by the caller).
 *
 *  #1007 — an `allow` list BEATS the block list: if the host is allow-listed
 *  (built-in major providers + privacy relays, plus any operator admin allow
 *  entry) it is NEVER disposable, whatever the block list says. The allow check
 *  runs first, so a false positive in a 10k aggregated list, or an over-broad
 *  admin addition, can never refuse a real provider. `allow` is optional so the
 *  old two-argument callers keep working (no allow list = block list only).
 *
 *  An address with no usable domain never matches — it is rejected earlier by
 *  the email-shape validation, not treated as disposable here. */
export function isDisposableEmail(
  email: string,
  domains: Iterable<string>,
  allow: Iterable<string> = [],
): boolean {
  const host = emailDomain(email);
  if (host === "") return false;
  if (hostCoveredByAny(host, allow)) return false;
  return hostCoveredByAny(host, domains);
}
