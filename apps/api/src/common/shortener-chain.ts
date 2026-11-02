/* ============================================================
   #994 — refusing redirect chains and loops.

   A short link whose destination is ITSELF another short link is a redirect
   chain: the visitor is bounced twice, the destination's owner can repoint it
   after ours was reviewed, and a destination pointing back at one of our own
   short domains is a loop waiting to happen. Both are refused on create and
   update, right beside the SSRF guard and the destination blocklist (#971).

   Two things are refused:

   1. A destination on one of SnapURL's OWN short domains (a self-referencing
      link — snap.to/a pointing at snap.to/b, or at any custom domain we host).
      The caller passes the set of our domains, read from the `domains` table,
      because it is data that changes as customers connect domains.

   2. A destination on a KNOWN third-party URL shortener (bit.ly, t.co, …).
      That list is maintained here as static data: it is policy, not per-request
      state, and keeping it beside the matcher means enforcement and its tests
      agree on exactly one list.

   The match rule is the blocklist's: a host matches when it equals a listed
   host OR is a sub-domain of one, case-insensitively and ignoring a trailing
   dot. So "bit.ly" also refuses "a.bit.ly" but not "notbit.ly" and not
   "bit.ly.evil.test". It reuses hostCoveredBy / destinationHost from
   blocklist.ts rather than restating the rule.

   Like blocklist.ts this lives in apps/api, not @snapurl/domain: it is
   server-only enforcement, not needed in the browser bundle, and a
   string-matcher of this shape cannot reach the domain package's 100%
   mutation-score bar (equivalent mutants where an early return equals the
   fallthrough), so it stays a plainly unit-tested helper here.
   ============================================================ */

import { destinationHost, hostCoveredBy, normaliseBlockHost } from "./blocklist.js";

/**
 * Known third-party URL shorteners. A destination on one of these is a redirect
 * chain: we would be shortening something that is already a short link, so the
 * real destination is outside our review and can be changed after the fact.
 *
 * Maintained by hand — it is deliberately a curated list of the common ones,
 * not an attempt at completeness. Add a host here (bare, lower-cased, no
 * scheme) to refuse it and every sub-domain of it.
 */
export const KNOWN_SHORTENER_HOSTS: readonly string[] = [
  "bit.ly",
  "bitly.com",
  "t.co",
  "tinyurl.com",
  "goo.gl",
  "ow.ly",
  "buff.ly",
  "is.gd",
  "rebrand.ly",
  "cutt.ly",
  "shorturl.at",
  "rb.gy",
  "t.ly",
  "bl.ink",
  "lnkd.in",
  "tiny.cc",
  "s.id",
  "short.io",
  "snip.ly",
  "v.gd",
  "trib.al",
] as const;

/** Why a destination was refused as a redirect chain. `self` is one of our own
 *  short domains (a loop); `shortener` is a known third-party shortener. */
export type ChainKind = "self" | "shortener";

export interface ChainMatch {
  kind: ChainKind;
  /** The listed host that matched, so the refusal can name it. */
  host: string;
}

/**
 * Whether `destination` is a redirect chain or a self-referencing loop, and
 * which. `selfHosts` is the set of SnapURL's own short domains (from the
 * `domains` table); `shortenerHosts` defaults to the maintained list above but
 * is injectable for tests.
 *
 * Self-domain is checked FIRST: a destination that is both one of our domains
 * and (improbably) a listed shortener is more usefully reported as the loop it
 * is. Returns null when the destination is neither.
 */
export function matchRedirectChain(
  destination: string,
  selfHosts: Iterable<string>,
  shortenerHosts: Iterable<string> = KNOWN_SHORTENER_HOSTS,
): ChainMatch | null {
  const host = destinationHost(destination);
  if (host === "") return null;

  for (const self of selfHosts) {
    if (hostCoveredBy(host, self)) return { kind: "self", host: normaliseBlockHost(self) };
  }
  for (const shortener of shortenerHosts) {
    if (hostCoveredBy(host, shortener)) return { kind: "shortener", host: normaliseBlockHost(shortener) };
  }
  return null;
}
