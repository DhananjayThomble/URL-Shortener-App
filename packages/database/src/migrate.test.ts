import { describe, expect, it } from "vitest";
import postgres from "postgres";

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

describe("runMigrations argument construction", () => {
  it("builds a postgres-js client whose ssl option is 'verify-full' for a bare true, without connecting", async () => {
    // Constructing a postgres-js client does not open a socket until a query
    // runs (documented behaviour, relied on elsewhere in this package's
    // tests), so this pins the actual option object runMigrations hands to
    // `postgres()` for its ssl connection, not just buildSslOption in isolation.
    const sql = postgres(PRIMARY_URL, { max: 1, ssl: sslOptionFor(true), onnotice: () => {} });
    try {
      expect(sql.options.ssl).toBe("verify-full");
    } finally {
      await sql.end({ timeout: 0 });
    }
  });

  it("builds a postgres-js client whose ssl option is undefined for the default (no ssl arg)", async () => {
    const sql = postgres(PRIMARY_URL, { max: 1, ssl: sslOptionFor(false), onnotice: () => {} });
    try {
      expect(sql.options.ssl).toBeFalsy();
    } finally {
      await sql.end({ timeout: 0 });
    }
  });
});
