/* ============================================================
   Trustworthy client IP from X-Forwarded-For.

   Both the API (rate limiting) and the redirect (visitorHash)
   need to know *who* is making a request. The naive answer —
   Fastify's `trustProxy: true`, which surfaces the LEFTMOST
   X-Forwarded-For entry as req.ip — is a value the client types.
   That defeats every rate limit and forges visitor identity.

   Fastify 5's numeric `trustProxy` hop-count is disabled and
   documented as unsafe: it cannot validate the immediate peer
   and lets direct clients spoof X-Forwarded-* values. So we do
   NOT lean on the framework; we parse the header ourselves, the
   same way in both services and in local dev.

   Why the RIGHTMOST entries are the trustworthy ones:
   CloudFront APPENDS the viewer IP to the END (right) of any
   client-supplied X-Forwarded-For rather than replacing it.
   Downstream appenders (API Gateway HTTP API v2, ELB, WAF)
   append their own edge IP after that. So for N trusted
   *appending* hops in front of this service, the trustworthy
   client IP is the (N+1)th entry counted from the RIGHT.

   SPOOF-PROOF PROPERTY: anything the attacker PREPENDS lands on
   the LEFT of the chain and shifts the whole prefix left, never
   touching the rightmost-minus-N position. So a client rotating
   or padding X-Forwarded-For can neither change the derived IP
   nor influence the visitorHash. This is enforced by unit tests
   in client-ip.test.ts.
   ============================================================ */

/**
 * Resolve the trustworthy client IP from a request's X-Forwarded-For
 * chain, given how many trusted proxies APPEND to that chain in front
 * of this service.
 *
 * @param opts.xff         The X-Forwarded-For header value. Fastify may
 *                         hand this over as a single comma-joined string
 *                         or, when the header appears multiple times, as
 *                         a string array. Both shapes are handled.
 * @param opts.socketIp    The peer address of the TCP connection. Used as
 *                         the fallback whenever the header cannot yield a
 *                         trustworthy entry (direct/local dev, no proxy).
 * @param opts.trustedHops The number of proxies in front of this service
 *                         that APPEND their edge IP to X-Forwarded-For.
 *                         0 = direct/local/compose (no trusted appender);
 *                         CloudFront alone = 1; CloudFront + an appending
 *                         API Gateway = 2; tune to the real topology.
 *
 * @returns The trustworthy client IP: the (trustedHops+1)th entry counted
 *          from the right of the chain, or `socketIp` when there is no
 *          usable entry at that position.
 */
export function clientIpFromXff(opts: {
  xff: string | string[] | undefined;
  socketIp: string;
  trustedHops: number;
}): string {
  const { xff, socketIp, trustedHops } = opts;

  // With no trusted appending proxy, the only address we can vouch for is the
  // immediate peer. This is the local-dev / compose / direct-hit path, where
  // there is no X-Forwarded-For (or one we must not trust). Return the socket.
  if (!Number.isFinite(trustedHops) || trustedHops <= 0) {
    return socketIp;
  }

  // Fastify hands multi-valued headers over as an array; a single header comes
  // as one comma-joined string. Normalise both to one comma-joined string.
  // Stryker equivalence (the `?? ""` fallback): this is only reached with
  // trustedHops >= 1 (hops <= 0 returned above). When xff is nullish the
  // fallback becomes the whole joined string, which splits to at most one
  // entry; since trustedHops >= 1, `entries.length <= trustedHops` holds and
  // socketIp is returned whether the fallback is "" (zero entries) or any
  // non-empty literal (one entry). Covered by the "no X-Forwarded-For" case.
  // Stryker disable next-line StringLiteral: equivalent — a nullish xff yields <= 1 entry, and with trustedHops>=1 that always falls back to socketIp regardless of this literal.
  const joined = Array.isArray(xff) ? xff.join(",") : (xff ?? "");

  const entries = joined
    .split(",")
    .map((entry) => entry.trim())
    .filter((entry) => entry.length > 0);

  // Not enough entries to index the (N+1)th from the right — the chain is
  // shorter than the topology claims (e.g. a request that never went through
  // the expected proxies). Fall back to the peer we can actually see.
  //
  // Stryker equivalence: this early return is a readability guard, not a
  // correctness gate. When entries.length <= trustedHops the index below is
  // `entries.length - 1 - trustedHops` <= -1, so `candidate` is `undefined`
  // and the `!candidate` guard a few lines down returns socketIp anyway.
  // Weakening `<=` to `<`, forcing the branch to `false`, or emptying its body
  // therefore produces identical observable behaviour on every input — the
  // defensive guard is a complete backstop. Covered behaviourally by the
  // "hops exceed/equal the number of entries" tests in client-ip.test.ts.
  // Stryker disable next-line EqualityOperator,ConditionalExpression,BlockStatement: equivalent — the `!candidate` guard below returns socketIp for every input this branch would catch.
  if (entries.length <= trustedHops) {
    return socketIp;
  }

  const candidate = entries[entries.length - 1 - trustedHops];

  // Defensive: a malformed/whitespace-only entry at the trusted position is
  // not something to hand downstream as an identity. Fall back to the socket.
  // Stryker equivalence: `candidate` is `entries[...]`, and `entries` was just
  // filtered to `entry.length > 0`, so a real indexed candidate is always a
  // non-empty string — `!candidate` and `candidate.length === 0` are both
  // always false here. (The only way to reach a missing slot is a negative
  // index, which the `entries.length <= trustedHops` guard above already
  // returned for.) This guard is belt-and-braces; no input can trigger it.
  // Stryker disable next-line ConditionalExpression,LogicalOperator,BlockStatement: equivalent — entries are pre-filtered to non-empty, so a selected candidate is never empty/undefined and this guard is unreachable.
  if (!candidate || candidate.length === 0) {
    return socketIp;
  }

  return candidate;
}
