import { z } from "zod";

/* ============================================================
   The one URL schema every URL-bearing field in the contract uses.

   Why this exists (issue #280): a bare `z.string().url()` only asserts that
   `new URL()` did not throw. That happily accepts `javascript:alert(1)`,
   `data:text/html;base64,…`, `file:///etc/passwd`, and links to internal
   hosts like `http://169.254.169.254/…` (the cloud metadata endpoint) or
   `http://10.0.0.5/admin`. Every one of those either leaves as a `Location`
   header from the redirect service (apps/redirect/src/main.ts) or is rendered
   as a clickable `<a href>` on the public trust page (web .../p/[slug]), so a
   shortener that accepts them is phishing / SSRF infrastructure by default.

   Keeping it in ONE place means a URL field added to the contract later cannot
   quietly skip the check: it imports `HttpUrl` like every other field.
   ============================================================ */

/**
 * Hosts that must never be a redirect or webhook destination.
 *
 * The ranges below are the ones an attacker reaches for: the loopback and
 * unspecified addresses, RFC 1918 private space, the 100.64/10 carrier-grade
 * NAT range, and — the one that matters most in a cloud deployment — the
 * 169.254.0.0/16 link-local block that carries the instance metadata service
 * at 169.254.169.254. With no NAT the reachable SSRF surface here is intra-VPC
 * (RDS is what is in there), but "different threat model" is not "no threat".
 */
const isDeniedIpv4 = (host: string): boolean => {
  const parts = host.split(".");
  if (parts.length !== 4) return false;
  const octets = parts.map((p) => Number(p));
  if (octets.some((o) => !Number.isInteger(o) || o < 0 || o > 255)) return false;
  const [a, b] = octets as [number, number, number, number];
  if (a === 0) return true; // 0.0.0.0/8 "this network"
  if (a === 10) return true; // 10.0.0.0/8 private
  if (a === 127) return true; // 127.0.0.0/8 loopback
  if (a === 169 && b === 254) return true; // 169.254.0.0/16 link-local (metadata)
  if (a === 172 && b >= 16 && b <= 31) return true; // 172.16.0.0/12 private
  if (a === 192 && b === 168) return true; // 192.168.0.0/16 private
  if (a === 100 && b >= 64 && b <= 127) return true; // 100.64.0.0/10 CGNAT
  return false;
};

const isDeniedIpv6 = (raw: string): boolean => {
  // URL hostnames wrap IPv6 in brackets; strip them and any zone id.
  const host = raw.replace(/^\[/, "").replace(/\]$/, "").split("%")[0]!.toLowerCase();
  if (host === "::" || host === "::1") return true; // unspecified / loopback
  if (host.startsWith("fe80")) return true; // link-local
  if (host.startsWith("fc") || host.startsWith("fd")) return true; // fc00::/7 unique-local
  // IPv4-mapped addresses. `new URL()` compresses ::ffff:169.254.169.254 to
  // ::ffff:a9fe:a9fe, so match on the ::ffff: prefix and rebuild the v4 tail
  // from either dotted-quad or the two hex groups, then reuse the v4 rules.
  const mapped = host.match(/^::ffff:(.+)$/);
  if (mapped) {
    const tail = mapped[1]!;
    if (tail.includes(".")) {
      if (isDeniedIpv4(tail)) return true;
    } else {
      const groups = tail.split(":");
      if (groups.length === 2) {
        const [hi, lo] = groups.map((g) => parseInt(g, 16)) as [number, number];
        if (Number.isInteger(hi) && Number.isInteger(lo)) {
          const dotted = `${(hi >> 8) & 0xff}.${hi & 0xff}.${(lo >> 8) & 0xff}.${lo & 0xff}`;
          if (isDeniedIpv4(dotted)) return true;
        }
      }
    }
  }
  return false;
};

/**
 * True when `host` is a name or address we refuse to point users at.
 *
 * `host` is the `hostname` from a parsed `URL`: lower-cased, no port, IPv6 in
 * brackets. Exported so callers that hold a raw host (not a full URL) can run
 * the same check.
 */
export const isDeniedHost = (host: string): boolean => {
  const h = host.toLowerCase();
  if (h === "localhost" || h.endsWith(".localhost")) return true;
  if (h.includes(":")) return isDeniedIpv6(h);
  return isDeniedIpv4(h);
};

/**
 * The shared schema: an absolute http(s) URL whose host is not private,
 * loopback or link-local. Use this for every URL field in the contract.
 *
 * `z.url({ protocol })` (zod 4) rejects non-http(s) schemes such as
 * `javascript:`, `data:`, `file:` and `ftp:` before the host check ever runs.
 */
export const HttpUrl = z
  .url({ protocol: /^https?$/, error: "Enter an absolute http(s) URL" })
  .refine(
    (value) => {
      let host: string;
      try {
        host = new URL(value).hostname;
      } catch {
        return false;
      }
      return !isDeniedHost(host);
    },
    { error: "That host isn't allowed (private, loopback or link-local address)" },
  );
export type HttpUrl = z.infer<typeof HttpUrl>;
