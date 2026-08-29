import { afterEach, describe, expect, it } from "vitest";
import { buildSslOption, createDatabase } from "./client.js";

/* Pure-logic checks for the read-replica plumbing. postgres-js does not open a
   socket until a query actually runs, so constructing the pools here is safe
   with no Postgres available — we only assert on handle identity and always
   close() to avoid leaking pools. */

const PRIMARY_URL = "postgres://user:pass@primary.example:5432/db";
const REPLICA_URL = "postgres://user:pass@replica.example:5432/db";

describe("createDatabase read-replica handle", () => {
  let handle: ReturnType<typeof createDatabase> | undefined;

  afterEach(async () => {
    if (handle) await handle.close();
    handle = undefined;
  });

  it("returns readDb as the same reference as db when no replicaUrl is given", () => {
    handle = createDatabase({ url: PRIMARY_URL });
    expect(handle.readDb).toBe(handle.db);
  });

  it("treats a replicaUrl equal to the primary url as single-node (readDb === db)", () => {
    handle = createDatabase({ url: PRIMARY_URL, replicaUrl: PRIMARY_URL });
    expect(handle.readDb).toBe(handle.db);
  });

  it("returns a distinct readDb handle when a different replicaUrl is given", () => {
    handle = createDatabase({ url: PRIMARY_URL, replicaUrl: REPLICA_URL });
    expect(handle.readDb).not.toBe(handle.db);
  });

  it("exposes the expected handle shape", () => {
    handle = createDatabase({ url: PRIMARY_URL });
    expect(handle).toHaveProperty("db");
    expect(handle).toHaveProperty("readDb");
    expect(handle).toHaveProperty("sql");
    expect(typeof handle.close).toBe("function");
  });
});

/* Security-critical: buildSslOption holds the TLS verification default and the
   opt-out precedence. These assertions are written so that reintroducing
   `{ rejectUnauthorized: false }` as the default (the old insecure behaviour)
   would make the "verify-full" and CA-bundle cases fail. */
describe("buildSslOption", () => {
  const CA_PEM = "-----BEGIN CERTIFICATE-----\nMIIBfake\n-----END CERTIFICATE-----";

  it("returns undefined when ssl is disabled", () => {
    expect(buildSslOption({ url: PRIMARY_URL, ssl: false })).toBeUndefined();
  });

  it("returns undefined when ssl is absent", () => {
    expect(buildSslOption({ url: PRIMARY_URL })).toBeUndefined();
  });

  it("returns { rejectUnauthorized: false } when ssl is on and sslNoVerify is set", () => {
    expect(buildSslOption({ url: PRIMARY_URL, ssl: true, sslNoVerify: true })).toEqual({
      rejectUnauthorized: false,
    });
  });

  it("verifies against a supplied CA bundle when ssl is on and sslCaCert is set", () => {
    const result = buildSslOption({ url: PRIMARY_URL, ssl: true, sslCaCert: CA_PEM });
    expect(result).toEqual({ ca: CA_PEM, rejectUnauthorized: true });
  });

  it("defaults to 'verify-full' when ssl is on and nothing else is set", () => {
    const result = buildSslOption({ url: PRIMARY_URL, ssl: true });
    // Must NOT silently disable verification: the default has to verify the chain
    // AND the hostname, never { rejectUnauthorized: false }.
    expect(result).toBe("verify-full");
    expect(result).not.toEqual({ rejectUnauthorized: false });
  });

  it("lets sslNoVerify win over sslCaCert when both are set (explicit opt-out wins)", () => {
    const result = buildSslOption({
      url: PRIMARY_URL,
      ssl: true,
      sslNoVerify: true,
      sslCaCert: CA_PEM,
    });
    expect(result).toEqual({ rejectUnauthorized: false });
  });
});
