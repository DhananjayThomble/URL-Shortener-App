import { describe, expect, it } from "vitest";
import { MailDomainService, type DnsResolver } from "./mail-domain.service.js";
import type { Env } from "../config/env.js";

/* ============================================================
   #1007 — the fail-open mail-domain check.

   These are UNIT tests: the DNS resolver is an injected stub, so no test
   touches the network or needs vi.mock, and the bounded-timeout path is driven
   with a resolver that never settles. The one property that matters most is
   FAIL OPEN — every inconclusive outcome (timeout, SERVFAIL, network error)
   must return false (do not refuse), and only a DEFINITIVE no-MX-and-no-A/AAAA
   returns true.
   ============================================================ */

/** A minimal Env for the service: the check on, a short timeout. */
function envWith(overrides: Partial<Env> = {}): Env {
  return {
    MAIL_DOMAIN_CHECK_ENABLED: true,
    MAIL_DOMAIN_CHECK_TIMEOUT_MS: 50,
    ...overrides,
  } as unknown as Env;
}

/** A Node DNS error with a `code`, as node:dns rejects with. */
function dnsError(code: string): NodeJS.ErrnoException {
  const err = new Error(`dns ${code}`) as NodeJS.ErrnoException;
  err.code = code;
  return err;
}

/** Build the service with a given env and resolver stub. */
function makeService(resolver: Partial<DnsResolver>, env: Env = envWith()): MailDomainService {
  const full: DnsResolver = {
    resolveMx: async () => [],
    resolve4: async () => [],
    resolve6: async () => [],
    ...resolver,
  };
  const svc = new MailDomainService(env);
  svc.setResolverForTesting(full);
  return svc;
}

describe("MailDomainService.hasNoMailRecords (#1007)", () => {
  it("refuses ONLY when MX, A and AAAA are all definitively empty (NXDOMAIN)", async () => {
    const svc = makeService({
      resolveMx: async () => {
        throw dnsError("ENOTFOUND");
      },
      resolve4: async () => {
        throw dnsError("ENOTFOUND");
      },
      resolve6: async () => {
        throw dnsError("ENOTFOUND");
      },
    });
    expect(await svc.hasNoMailRecords("no-such-domain.test")).toBe(true);
  });

  it("refuses on NODATA for all three (name exists, no records of any type)", async () => {
    const svc = makeService({
      resolveMx: async () => {
        throw dnsError("ENODATA");
      },
      resolve4: async () => {
        throw dnsError("ENODATA");
      },
      resolve6: async () => {
        throw dnsError("ENODATA");
      },
    });
    expect(await svc.hasNoMailRecords("parked.test")).toBe(true);
  });

  it("PASSES when an MX record exists", async () => {
    const svc = makeService({
      resolveMx: async () => [{ exchange: "mx.real.test", priority: 10 }],
      resolve4: async () => {
        throw dnsError("ENODATA");
      },
      resolve6: async () => {
        throw dnsError("ENODATA");
      },
    });
    expect(await svc.hasNoMailRecords("real.test")).toBe(false);
  });

  it("PASSES on the implicit-MX fallback: no MX but an A record exists", async () => {
    const svc = makeService({
      resolveMx: async () => [],
      resolve4: async () => ["203.0.113.7"],
      resolve6: async () => {
        throw dnsError("ENODATA");
      },
    });
    expect(await svc.hasNoMailRecords("a-only.test")).toBe(false);
  });

  it("PASSES when only an AAAA record exists", async () => {
    const svc = makeService({
      resolveMx: async () => [],
      resolve4: async () => [],
      resolve6: async () => ["2001:db8::1"],
    });
    expect(await svc.hasNoMailRecords("v6-only.test")).toBe(false);
  });

  // ── fail open ──

  it("FAILS OPEN on a DNS error that is not definitive (SERVFAIL)", async () => {
    const svc = makeService({
      resolveMx: async () => {
        throw dnsError("ESERVFAIL");
      },
      resolve4: async () => {
        throw dnsError("ESERVFAIL");
      },
      resolve6: async () => {
        throw dnsError("ESERVFAIL");
      },
    });
    expect(await svc.hasNoMailRecords("flaky.test")).toBe(false);
  });

  it("FAILS OPEN when a lookup never settles (timeout)", async () => {
    const never = () => new Promise<never>(() => {});
    const svc = makeService(
      { resolveMx: never, resolve4: never, resolve6: never },
      envWith({ MAIL_DOMAIN_CHECK_TIMEOUT_MS: 20 }),
    );
    const start = Date.now();
    expect(await svc.hasNoMailRecords("slow.test")).toBe(false);
    // The bound is honoured: it returns well under a second, not hanging.
    expect(Date.now() - start).toBeLessThan(1_000);
  });

  it("FAILS OPEN when SOME lookups are definitive-empty but one is inconclusive", async () => {
    // MX + A are a definitive NXDOMAIN, but AAAA times out → we do NOT have a
    // definitive no-mail answer, so we must pass.
    const svc = makeService(
      {
        resolveMx: async () => {
          throw dnsError("ENOTFOUND");
        },
        resolve4: async () => {
          throw dnsError("ENOTFOUND");
        },
        resolve6: () => new Promise<never>(() => {}),
      },
      envWith({ MAIL_DOMAIN_CHECK_TIMEOUT_MS: 20 }),
    );
    expect(await svc.hasNoMailRecords("partial.test")).toBe(false);
  });

  // ── guards ──

  it("is a no-op (returns false) when the check is disabled", async () => {
    const svc = makeService(
      {
        resolveMx: async () => {
          throw dnsError("ENOTFOUND");
        },
        resolve4: async () => {
          throw dnsError("ENOTFOUND");
        },
        resolve6: async () => {
          throw dnsError("ENOTFOUND");
        },
      },
      envWith({ MAIL_DOMAIN_CHECK_ENABLED: false }),
    );
    // Even though DNS would say no-mail, the disabled check never refuses.
    expect(await svc.hasNoMailRecords("no-such-domain.test")).toBe(false);
  });

  it("returns false for an empty host without touching DNS", async () => {
    let called = false;
    const svc = makeService({
      resolveMx: async () => {
        called = true;
        return [];
      },
    });
    expect(await svc.hasNoMailRecords("")).toBe(false);
    expect(called).toBe(false);
  });
});
