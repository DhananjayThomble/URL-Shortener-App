import { Inject, Injectable, Logger } from "@nestjs/common";
import { resolveMx, resolve4, resolve6 } from "node:dns/promises";
import { ENV, type Env } from "../config/env.js";

/* ============================================================
   #1007 — the sign-up mail-domain check.

   Refuse a sign-up ONLY when the email's domain DEFINITIVELY cannot receive
   mail: DNS reports NO MX record AND no A/AAAA fallback. A mail server is
   reached by MX; a domain with no MX but an A/AAAA record is still a valid mail
   target (RFC 5321 §5.1 "implicit MX"), so all three must be empty to refuse.

   FAIL OPEN. This is an anti-abuse nicety, not a security control, and a DNS
   resolver is flaky: a timeout, a SERVFAIL, a transient network error — anything
   other than a definitive "this name has no mail route" — PASSES. The cost of a
   wrong refusal (turning away a real person because our resolver hiccuped) is
   far worse than letting one bad address through, which the list check and
   verification email already guard. So the only refusal is on NXDOMAIN or NODATA
   for all three record types; everything else, including every error, passes.

   BOUNDED. Each lookup is raced against a short timeout (env
   MAIL_DOMAIN_CHECK_TIMEOUT_MS, ~1.5 s) so a slow resolver cannot stall a
   sign-up. A timed-out lookup is treated exactly like an error: it fails open.

   NO NETWORK IN UNIT TESTS. The three resolver functions are an injected seam
   (resolverFor), defaulting to node:dns/promises in production. A unit test
   constructs the service with stub resolvers and never touches the network or
   needs vi.mock; the bounded-timeout path is driven with a resolver that never
   settles.
   ============================================================ */

/** The DNS surface this service needs: the three record lookups, each either
 *  resolving to its records or rejecting with a Node DNS error whose `code`
 *  says why (ENOTFOUND/NXDOMAIN = the name does not exist; ENODATA = the name
 *  exists but has no record of this type). The real implementation is
 *  node:dns/promises; a test passes stubs. */
export interface DnsResolver {
  resolveMx(host: string): Promise<Array<{ exchange: string; priority: number }>>;
  resolve4(host: string): Promise<string[]>;
  resolve6(host: string): Promise<string[]>;
}

const REAL_RESOLVER: DnsResolver = { resolveMx, resolve4, resolve6 };

/** A sentinel distinct from any DNS result, resolved when the per-lookup budget
 *  elapses. */
const TIMED_OUT = Symbol("dns-timeout");

@Injectable()
export class MailDomainService {
  private readonly logger = new Logger(MailDomainService.name);
  private readonly enabled: boolean;
  private readonly timeoutMs: number;

  /** The resolver. A plain field (NOT a constructor DI parameter) so Nest never
   *  tries to resolve node:dns/promises as a provider; a test swaps it via
   *  setResolverForTesting. */
  private resolver: DnsResolver = REAL_RESOLVER;

  constructor(@Inject(ENV) env: Env) {
    this.enabled = env.MAIL_DOMAIN_CHECK_ENABLED;
    this.timeoutMs = env.MAIL_DOMAIN_CHECK_TIMEOUT_MS;
  }

  /** Test-only: replace the DNS resolver so a unit test runs without a network
   *  or vi.mock. Not used by production code. */
  setResolverForTesting(resolver: DnsResolver): void {
    this.resolver = resolver;
  }

  /**
   * Whether `host` (a bare, already-normalised mail domain) DEFINITIVELY has no
   * way to receive mail — no MX and no A/AAAA. Returns `true` ONLY in that
   * definitive case; a timeout, a DNS error, or any record found returns
   * `false` (fail open). Never throws.
   *
   * When the check is disabled (test/compose env) it always returns `false`.
   */
  async hasNoMailRecords(host: string): Promise<boolean> {
    if (!this.enabled || host === "") return false;

    const [mx, a, aaaa] = await Promise.all([
      this.lookup(() => this.resolver.resolveMx(host)),
      this.lookup(() => this.resolver.resolve4(host)),
      this.lookup(() => this.resolver.resolve6(host)),
    ]);

    // Fail open: if ANY lookup was inconclusive (a timeout or a non-definitive
    // error, surfaced as `null`), we do not have a definitive no-mail answer.
    if (mx === null || a === null || aaaa === null) return false;

    // All three resolved to a definitive emptiness → the domain cannot receive
    // mail. This is the only path that refuses.
    return mx.length === 0 && a.length === 0 && aaaa.length === 0;
  }

  /**
   * Run one DNS lookup under the timeout and fold its outcome into one of:
   *   - the records array (possibly empty) when DNS gave a DEFINITIVE answer,
   *     including a definitive "no such record" (ENOTFOUND/NXDOMAIN/ENODATA),
   *     which is returned as an empty array;
   *   - `null` when the answer is INCONCLUSIVE: a timeout, or any other DNS
   *     error (SERVFAIL, ETIMEOUT, network error). `null` makes the caller fail
   *     open.
   */
  private async lookup<T>(fn: () => Promise<T[]>): Promise<T[] | null> {
    let timer: NodeJS.Timeout | undefined;
    const timeout = new Promise<typeof TIMED_OUT>((resolve) => {
      timer = setTimeout(() => resolve(TIMED_OUT), this.timeoutMs);
      // Don't keep the event loop alive just for this guard.
      timer.unref?.();
    });
    try {
      const result = await Promise.race([
        fn().then((records) => ({ ok: true as const, records })),
        timeout,
      ]);
      if (result === TIMED_OUT) return null; // inconclusive → fail open
      return result.records;
    } catch (err) {
      const code = (err as NodeJS.ErrnoException)?.code;
      // A definitive "the name / this record does not exist" → an empty result,
      // which contributes to a refusal only if ALL THREE are empty.
      if (code === "ENOTFOUND" || code === "NXDOMAIN" || code === "ENODATA") return [];
      // Anything else (SERVFAIL, ETIMEOUT, a network blip) is inconclusive.
      this.logger.debug({ code }, "mail-domain DNS lookup inconclusive; failing open");
      return null;
    } finally {
      if (timer) clearTimeout(timer);
    }
  }
}
