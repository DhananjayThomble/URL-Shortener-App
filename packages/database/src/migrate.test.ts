import { describe, expect, it, vi, beforeEach } from "vitest";

/* runMigrations' TLS handling is security-critical (#580): `ssl: true` must
   verify the certificate chain and hostname by default, the same policy
   buildSslOption enforces for createDatabase in client.ts. These assertions
   are written so that reintroducing the old unconditional
   `{ rejectUnauthorized: false }` for any truthy `ssl` argument would fail
   the "boolean true" and "verify-full default" cases below.

   We exercise this via the same postgres-js `ssl` option shape runMigrations
   builds, without opening a real connection: postgres-js does not connect
   until a query runs, so constructing the client and inspecting its resolved
   ssl option is safe and needs no database. */

/** Mirrors resolveSslOption's construction inside migrate.ts closely enough to
 *  pin the postgres-js `ssl` option a given argument produces, without
 *  exporting an internal helper. We import runMigrations itself for the
 *  behavioural cases and rely on postgres.js's own option-normalisation only
 *  for the pure-shape cases below via buildSslOption directly (already
 *  covered in client.test.ts) — here we pin the migrate.ts entry point's
 *  contract with client.ts's policy end-to-end. */
import { buildSslOption } from "./client.js";
import type { MigrateSslOption } from "./migrate.js";

const PRIMARY_URL = "postgres://user:pass@primary.example:5432/db";

/* ============================================================
   Seam around the actual runMigrations -> postgres() call.

   The suite above pins buildSslOption's own contract but never calls
   runMigrations, so a regression *inside* migrate.ts itself — e.g.
   resolveSslOption reverting to the old unconditional
   `{ rejectUnauthorized: false }`, or runMigrations no longer routing
   through resolveSslOption at all — would not fail any of it. Confirmed by
   mutation: restoring `ssl: true -> { rejectUnauthorized: false }` inside
   migrate.ts left every case above green.

   `postgres` and the drizzle migrator are mocked so runMigrations runs for
   real (no stubbed re-implementation of its logic) without opening a
   socket or touching a migrations folder: we intercept the exact options
   object the module hands to `postgres()`. */
const postgresOptionsCalls: Array<Record<string, unknown>> = [];

vi.mock("postgres", () => ({
  default: vi.fn((_url: string, options: Record<string, unknown>) => {
    postgresOptionsCalls.push(options);
    return { end: vi.fn().mockResolvedValue(undefined) };
  }),
}));

vi.mock("drizzle-orm/postgres-js", () => ({
  drizzle: vi.fn(() => ({})),
}));

vi.mock("drizzle-orm/postgres-js/migrator", () => ({
  migrate: vi.fn().mockResolvedValue(undefined),
}));

describe("runMigrations (real call, mocked postgres()/migrate())", () => {
  beforeEach(() => {
    postgresOptionsCalls.length = 0;
    vi.clearAllMocks();
  });

  it("passes ssl:'verify-full' to postgres() for a bare `ssl: true`, never rejectUnauthorized:false", async () => {
    const { runMigrations } = await import("./migrate.js");
    await runMigrations(PRIMARY_URL, true);

    expect(postgresOptionsCalls).toHaveLength(1);
    expect(postgresOptionsCalls[0]?.ssl).toBe("verify-full");
    expect(postgresOptionsCalls[0]?.ssl).not.toEqual({ rejectUnauthorized: false });
  });

  it("passes ssl:undefined to postgres() for the default (no ssl arg)", async () => {
    const { runMigrations } = await import("./migrate.js");
    await runMigrations(PRIMARY_URL);

    expect(postgresOptionsCalls).toHaveLength(1);
    expect(postgresOptionsCalls[0]?.ssl).toBeUndefined();
  });

  it("only disables verification via the explicit sslNoVerify opt-out", async () => {
    const { runMigrations } = await import("./migrate.js");
    await runMigrations(PRIMARY_URL, { ssl: true, sslNoVerify: true });

    expect(postgresOptionsCalls).toHaveLength(1);
    expect(postgresOptionsCalls[0]?.ssl).toEqual({ rejectUnauthorized: false });
  });
});

function sslOptionFor(ssl: MigrateSslOption) {
  const opts = typeof ssl === "boolean" ? { url: PRIMARY_URL, ssl } : { url: PRIMARY_URL, ...ssl };
  return buildSslOption(opts);
}

describe("runMigrations TLS policy (via the same buildSslOption migrate.ts delegates to)", () => {
  it("does not enable TLS when ssl is omitted (back-compat default)", () => {
    expect(sslOptionFor(false)).toBeUndefined();
  });

  it("defaults a bare `ssl: true` boolean to 'verify-full', never rejectUnauthorized:false", () => {
    const result = sslOptionFor(true);
    expect(result).toBe("verify-full");
    expect(result).not.toEqual({ rejectUnauthorized: false });
  });

  it("defaults an options object with ssl:true and nothing else to 'verify-full'", () => {
    const result = sslOptionFor({ ssl: true });
    expect(result).toBe("verify-full");
  });

  it("only disables verification via the explicit sslNoVerify opt-out", () => {
    expect(sslOptionFor({ ssl: true, sslNoVerify: true })).toEqual({ rejectUnauthorized: false });
  });

  it("verifies against a supplied CA bundle when sslCaCert is set", () => {
    const CA_PEM = "-----BEGIN CERTIFICATE-----\nMIIBfake\n-----END CERTIFICATE-----";
    expect(sslOptionFor({ ssl: true, sslCaCert: CA_PEM })).toEqual({ ca: CA_PEM, rejectUnauthorized: true });
  });
});
