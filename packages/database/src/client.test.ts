import { afterEach, describe, expect, it } from "vitest";
import { createDatabase } from "./client.js";

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
