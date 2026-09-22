import { lookup } from "node:dns/promises";
import { BadRequestException } from "@nestjs/common";
import { isDeniedHost, isDeniedIpv4, isDeniedIpv6 } from "@snapurl/contract";

/* ============================================================
   The DNS-resolving half of the SSRF guard.

   `HttpUrl` (packages/contract/src/http-url.ts) rejects a *literal* denied
   address — an IP or `localhost` written directly in the URL — synchronously,
   at contract-validation time. It cannot catch a public-looking DNS name that
   *resolves* to a denied address: `169.254.169.254.nip.io` and any other
   attacker-controlled name pointed at an internal or metadata address. That
   needs a DNS lookup, which is I/O, which is why it is not part of the zod
   schema (zod's synchronous `parse`/`safeParse` — used by the bulk-create
   per-row path, the browser extension, and every existing contract test —
   cannot run an async refinement) and why it cannot live in packages/contract
   at all (that package is imported by web/'s browser bundle, which cannot
   resolve a `node:dns` import).

   This is the explicit, server-only second step: call `assertNoSsrfDnsTarget`
   once per URL field right after the sync contract schema has already
   accepted the request body, for every field that ends up as a real
   server-side request — a webhook endpoint the worker `fetch()`s
   (apps/worker/src/jobs/webhooks.ts) — or a redirect a victim's browser
   follows (a link destination, routing-rule target, or scheduled/expiry
   redirect).
   ============================================================ */

/**
 * True when `url`'s host is, or resolves to, a private, loopback or
 * link-local address.
 *
 * Resolves with `dns.lookup(host, { all: true })`, which follows the same
 * getaddrinfo path Node's own `fetch` and `net.connect` use, so this check
 * and the eventual connection agree on what an address "is" for
 * wildcard/CNAME-heavy setups. `all: true` catches a name that resolves to
 * *any* denied address even when a public one is also returned — DNS
 * rebinding depends on the attacker choosing which answer is used at request
 * time, not on this check happening to pick the safe one.
 *
 * Returns `false` (does not deny) when the lookup itself fails — an
 * unresolvable name cannot be reached by the worker or a redirect either, and
 * treating "NXDOMAIN" the same as "resolves to metadata" would reject
 * harmless typos and transient DNS hiccups with the same security-guard error
 * a real attempt gets. The caller's own network call fails with its own,
 * clearer error if the name truly does not resolve.
 */
export async function resolvesToDeniedAddress(url: string): Promise<boolean> {
  let host: string;
  try {
    host = new URL(url).hostname;
  } catch {
    return false;
  }

  // Already caught by the sync contract check, but cheap to short-circuit
  // here too rather than round-trip a lookup for a literal IP.
  if (isDeniedHost(host)) return true;

  let records: Array<{ address: string; family: number }>;
  try {
    records = await lookup(host, { all: true, verbatim: true });
  } catch {
    return false;
  }

  return records.some((record) =>
    record.family === 6 ? isDeniedIpv6(record.address) : isDeniedIpv4(record.address),
  );
}

/**
 * Throws a 400 if any of `urls` resolves to a private, loopback or link-local
 * address. Skips `null`/`undefined` entries so callers can pass optional
 * fields straight through without an `if` per field.
 */
export async function assertNoSsrfDnsTarget(urls: Array<string | null | undefined>): Promise<void> {
  for (const url of urls) {
    if (!url) continue;
    if (await resolvesToDeniedAddress(url)) {
      throw new BadRequestException({
        statusCode: 400,
        error: "Bad Request",
        message: [`That host isn't allowed (it resolves to a private, loopback or link-local address): ${url}`],
      });
    }
  }
}
