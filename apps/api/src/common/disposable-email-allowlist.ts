/* ============================================================
   #1007 — the built-in disposable-email ALLOW list.

   WHAT THIS IS
   A small, hand-maintained set of mail domains that must NEVER be refused as
   "disposable", whatever any block list says. It is the safety net under the
   full ~10k vendored upstream list (disposable-email-domains.ts): an aggregated
   throwaway-domain list can wrongly sweep in a real provider, and a false
   refusal there turns away a legitimate signer-up. So the allow list BEATS
   every block list — the vendored list, the operator's admin additions, and any
   future list — and a unit test fails the build if any entry here ever appears
   in the vendored block list (disposable-email.test.ts).

   WHAT BELONGS HERE
   Only domains we are confident are real, durable mail providers or privacy
   relays that forward to a real inbox:
     • the major consumer mail providers, and
     • the privacy relays people legitimately sign up with (Apple Hide My Email,
       DuckDuckGo, Firefox Relay, SimpleLogin, AnonAddy).
   A relay is deliberately allowed: it forwards to a real inbox the person
   controls, so it is not throwaway in the sense the block list targets, and
   refusing it punishes a privacy-conscious real user.

   This is NOT the place to add a domain just because a user complained — that is
   what the admin allow list in platform settings (#972) is for, which an
   operator edits at runtime without a release. This built-in list changes only
   by code review.

   SHAPE
   Bare registrable hosts, lower-cased, sorted, de-duped. A sub-domain of an
   entry is covered by the same hostCoveredBy rule the block list uses, so list
   only the registrable host (allowing "proton.me" also allows "pm.proton.me").
   Server-only, like disposable-email.ts, for the same reasons.
   ============================================================ */

/** Mail domains that are always allowed, overriding every block list. Bare,
 *  lower-cased, sorted hosts; a sub-domain of any entry is also allowed. */
export const DISPOSABLE_EMAIL_ALLOWLIST: readonly string[] = [
  // Privacy relays that forward to a real inbox the person controls.
  "anonaddy.com",
  "anonaddy.me",
  "duck.com",
  "mozmail.com",
  "privaterelay.appleid.com",
  "simplelogin.com",
  "simplelogin.io",
  // Major consumer mail providers.
  "aol.com",
  "fastmail.com",
  "gmail.com",
  "gmx.com",
  "gmx.de",
  "gmx.net",
  "googlemail.com",
  "hey.com",
  "hotmail.co.uk",
  "hotmail.com",
  "hotmail.fr",
  "icloud.com",
  "live.com",
  "live.co.uk",
  "mail.com",
  "me.com",
  "msn.com",
  "outlook.com",
  "outlook.fr",
  "pm.me",
  "proton.me",
  "protonmail.ch",
  "protonmail.com",
  "yahoo.co.uk",
  "yahoo.com",
  "yandex.com",
  "zoho.com",
];
