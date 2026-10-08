import http from "node:http";
import https from "node:https";
import { lookup as dnsLookup, type LookupAddress } from "node:dns";
import type { LookupFunction } from "node:net";
import { isDeniedHost, isDeniedIpv4, isDeniedIpv6 } from "@snapurl/contract";

/* ============================================================
   POST to a user-supplied URL without letting it reach our own network (#622).

   A webhook endpoint is a URL a user typed in, and the worker sends requests to
   it from inside our infrastructure. If that URL points at an internal address,
   such as the cloud metadata service at 169.254.169.254, the worker would be
   making requests on the attacker's behalf. That is server-side request forgery
   (SSRF).

   Checking the URL when the webhook is saved is not enough on its own:
   - DNS can change later. A name can resolve to a public address when it's
     saved, then to an internal one when the worker sends ("DNS rebinding").
   - A receiver can answer with a redirect to an internal address.

   So this helper:
   1. refuses a URL whose host is a literal internal address or `localhost`;
   2. checks every address the name resolves to *inside the socket's own DNS
      lookup*, so the address that was checked is the address it connects to;
   3. never follows redirects. A 3xx counts as a failed delivery.
   ============================================================ */

export class BlockedAddressError extends Error {
  constructor(host: string) {
    super(`Blocked: ${host} is, or resolves to, a private, loopback or link-local address`);
    this.name = "BlockedAddressError";
  }
}

const isDeniedAddress = (a: LookupAddress): boolean =>
  a.family === 6 ? isDeniedIpv6(a.address) : isDeniedIpv4(a.address);

/** `dns.lookup`, except it fails when any resolved address is internal. */
export const guardedLookup: LookupFunction = (hostname, options, callback) => {
  dnsLookup(hostname, { ...options, all: true }, (err, addresses) => {
    if (err) return callback(err, "", 0);
    const list = addresses as LookupAddress[];
    if (list.length === 0 || list.some(isDeniedAddress)) {
      return callback(new BlockedAddressError(hostname), "", 0);
    }
    // Node asks for every address when it races IPv4 against IPv6, and for a
    // single one otherwise. Answer in the shape it asked for.
    if (options.all) return callback(null, list);
    return callback(null, list[0]!.address, list[0]!.family);
  });
};

export interface SafePostOptions {
  headers: Record<string, string>;
  body: string;
  timeoutMs: number;
  /** Only for tests, which need to reach a local server. Production uses `guardedLookup`. */
  lookup?: LookupFunction;
}

/** POSTs `body` to `url` and resolves with the HTTP status code. */
export function safePost(url: string, opts: SafePostOptions): Promise<number> {
  return new Promise((resolve, reject) => {
    let target: URL;
    try {
      target = new URL(url);
    } catch {
      return reject(new Error(`Not a valid URL: ${url}`));
    }
    if (target.protocol !== "https:" && target.protocol !== "http:") {
      return reject(new Error(`Only http and https endpoints are allowed: ${url}`));
    }
    // A literal IP never goes through DNS, so the lookup guard would not see it.
    if (isDeniedHost(target.hostname)) return reject(new BlockedAddressError(target.hostname));

    const send = target.protocol === "https:" ? https.request : http.request;
    const req = send(
      target,
      {
        method: "POST",
        headers: { ...opts.headers, "Content-Length": Buffer.byteLength(opts.body) },
        lookup: opts.lookup ?? guardedLookup,
        signal: AbortSignal.timeout(opts.timeoutMs),
      },
      (res) => {
        res.resume(); // the body isn't used; drain it so the socket is freed
        resolve(res.statusCode ?? 0);
      },
    );
    req.on("error", reject);
    req.end(opts.body);
  });
}
