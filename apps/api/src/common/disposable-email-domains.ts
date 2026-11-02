/* ============================================================
   #993 — the vendored disposable-email domain list.

   WHAT THIS IS
   A snapshot of well-known throwaway / temporary email providers, used to
   refuse sign-up from an address at one of them (see disposable-email.ts for
   the matcher, which also folds in the operator's own admin additions).

   SOURCE & LICENCE
   The domains are drawn from the public, community-maintained
   `disposable-email-domains` project
   (https://github.com/disposable-email-domains/disposable-email-domains),
   which releases its list into the public domain under CC0-1.0 (a copy of the
   dedication lives beside this file as disposable-email-domains.LICENCE). CC0
   imposes no attribution or share-alike obligation; the attribution here is
   courtesy, not a requirement.

   This is a CURATED SUBSET, not the full upstream list (which is ~4k domains
   and churns daily). It covers the providers that actually show up in abuse,
   and the gap is covered two ways: an operator adds a newly-seen domain from
   the admin panel in seconds (disposableEmails.extraDomains), and the vendored
   list is refreshed on the cadence below. Keeping a bounded, reviewed subset in
   the repo — rather than a 4k-line generated blob — keeps the diff reviewable
   and the secret-scan fast, at the cost of leaning on admin additions between
   refreshes.

   UPDATE NOTE
   To refresh: pull the upstream `disposable_email_blocklist.conf`, keep the
   entries that matter for this product, re-sort, and replace the array below.
   Entries are bare registrable hosts, lower-cased, one per provider; a
   sub-domain is matched by hostCoveredBy, so only the registrable host is
   listed. Last reviewed: 2026-11-01.
   ============================================================ */

/** The vendored throwaway-email hosts. Bare, lower-cased, sorted. A sub-domain
 *  of any entry is covered by the matcher, so list only the registrable host. */
export const VENDORED_DISPOSABLE_EMAIL_DOMAINS: readonly string[] = [
  "0-mail.com",
  "10minutemail.com",
  "10minutemail.net",
  "20minutemail.com",
  "33mail.com",
  "aaathats3as.com",
  "anonbox.net",
  "anonymbox.com",
  "burnermail.io",
  "dispostable.com",
  "dropmail.me",
  "emailondeck.com",
  "fakeinbox.com",
  "fakemailgenerator.com",
  "getairmail.com",
  "getnada.com",
  "guerrillamail.biz",
  "guerrillamail.com",
  "guerrillamail.de",
  "guerrillamail.net",
  "guerrillamail.org",
  "guerrillamailblock.com",
  "harakirimail.com",
  "inboxbear.com",
  "incognitomail.com",
  "jetable.org",
  "mailcatch.com",
  "maildrop.cc",
  "maileater.com",
  "mailexpire.com",
  "mailinator.com",
  "mailinator.net",
  "mailnesia.com",
  "mailnull.com",
  "mailsac.com",
  "mintemail.com",
  "mohmal.com",
  "moakt.com",
  "mytemp.email",
  "nowmymail.com",
  "nwytg.net",
  "proxymail.eu",
  "rtrtr.com",
  "sharklasers.com",
  "spam4.me",
  "spamgourmet.com",
  "tempail.com",
  "temp-mail.io",
  "temp-mail.org",
  "tempinbox.com",
  "tempmail.com",
  "tempmail.net",
  "tempmailo.com",
  "tempomail.fr",
  "tempr.email",
  "throwawaymail.com",
  "trashmail.com",
  "trashmail.de",
  "trashmail.net",
  "trbvm.com",
  "yopmail.com",
  "yopmail.fr",
  "yopmail.net",
  "zeroe.ml",
  "zippymail.info",
];
