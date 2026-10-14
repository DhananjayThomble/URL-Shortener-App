import "reflect-metadata";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Database } from "@snapurl/database";
import { DomainsService } from "./domains.service.js";

/* ============================================================
   #713 item 1 — non-Latin-1 domain root / 404 redirects must be normalised at
   the API write path, not stored raw.

   The symptom: a domain redirect whose URL carries characters beyond Latin-1
   (an IDN host, or a CJK/emoji path or query) SAVES successfully, but a visitor
   then gets a 500. The redirect service emits the stored string verbatim as a
   `Location` header, and Node's HTTP layer refuses non-Latin-1 header bytes.

   Links do NOT 500 on the same URLs: the redirect serves a link destination
   through packages/domain buildDestination, which runs `new URL(dest).toString()`
   and emits the normalised (host punycoded, path/query percent-encoded) href.
   Domains stored the raw string, so this test pins the fix: add() and update()
   must persist `new URL(value).href` — a header-safe value — for both
   rootRedirect and notFoundRedirect.

   This is a UNIT spec: it mocks the db so it runs in the ordinary (non-DB)
   vitest lane. The DATABASE_URL-gated integration spec
   (domains.update.integration.test.ts) cannot run in-sandbox (Docker is
   non-functional), so the assertion that the WRITTEN value is normalised lives
   here, where the fake db captures exactly what the service hands to Drizzle.
   ============================================================ */

// assertNoSsrfDnsTarget resolves the host via dns.lookup; an IDN host would not
// resolve in-sandbox. Stub it to a public address so the guard is a no-op and
// the test exercises the normalisation, not DNS.
vi.mock("node:dns/promises", () => ({
  lookup: vi.fn(async () => [{ address: "93.184.215.14", family: 4 }]),
  resolveTxt: vi.fn(),
}));

/** A fake db that records what add()/update() write, and plays back the row.
 *  `mode` picks the select sequence:
 *    - "add": the single select is the global-uniqueness check — resolve [] (not taken).
 *    - "update": the first select is the owned-row pre-read ([existingRow]); the
 *      trailing select is the per-domain link count ([{ n: 0 }]).
 */
function makeFakeDb(mode: "add" | "update") {
  const inserted: Array<Record<string, unknown>> = [];
  const updated: Array<Record<string, unknown>> = [];
  // The domain row the pre-read in update() returns (an owned, non-system row).
  const existingRow = {
    id: "019a1b2c-3d4e-7f80-9a1b-2c3d4e5f6a7b",
    workspaceId: "ws-1",
    domain: "mine.example",
    isSystem: false,
    status: "live",
    ssl: "active",
    sslRenewsAt: null,
    rootRedirect: null,
    notFoundRedirect: null,
    verificationToken: null,
  };

  let selectCall = 0;
  const select = () => {
    const which = selectCall++;
    // add(): the only .limit() select is the uniqueness check → not taken.
    // update(): first .limit() is the pre-read; the final select resolves a count.
    const limitRows = mode === "add" ? [] : which === 0 ? [existingRow] : [{ n: 0 }];
    const builder: any = {
      from: () => builder,
      where: () => builder,
      limit: () => Promise.resolve(limitRows),
      groupBy: () => Promise.resolve([]),
      orderBy: () => Promise.resolve([]),
      // update()'s trailing link-count query is awaited straight off .where(),
      // so the builder itself must be thenable and resolve the count rows.
      then: (resolve: (rows: unknown[]) => unknown) => resolve(limitRows),
    };
    return builder;
  };

  const makeInsert = (sink: Array<Record<string, unknown>>) => () => ({
    values: (vals: Record<string, unknown>) => {
      sink.push(vals);
      return {
        returning: async () => [{ ...existingRow, ...vals }],
      };
    },
  });

  const update = () => ({
    set: (vals: Record<string, unknown>) => {
      updated.push(vals);
      return {
        where: () => ({ returning: async () => [{ ...existingRow, ...vals }] }),
      };
    },
  });

  const tx: any = {
    insert: makeInsert(inserted),
    update,
    select,
  };

  const db = {
    select,
    insert: makeInsert(inserted),
    update,
    transaction: (cb: (t: typeof tx) => unknown) => cb(tx),
  } as unknown as Database;

  return { db, inserted, updated };
}

const actor = {
  userId: null,
  workspaceId: "ws-1",
  role: "admin" as const,
  email: "admin@example.com",
  label: "admin@example.com",
};

describe("#713 item 1 — DomainsService normalises redirects to a header-safe href", () => {
  const nudge = vi.fn();

  beforeEach(() => {
    nudge.mockReset();
  });
  afterEach(() => {
    vi.clearAllMocks();
  });

  const idnHost = "https://例え.テスト/パス";
  const cjkPath = "https://example.com/路径?q=値";
  const ascii = "https://example.org/plain";

  it("add() persists new URL(value).href for a non-Latin-1 IDN host, not the raw string", async () => {
    const { db, inserted } = makeFakeDb("add");
    const service = new DomainsService(db, { nudge } as never);

    const dto = await service.add("ws-1", { domain: "fresh.example", rootRedirect: idnHost });

    const written = inserted[0]!.rootRedirect;
    expect(written).toBe(new URL(idnHost).href);
    expect(written).not.toBe(idnHost);
    expect(dto.rootRedirect).toBe(new URL(idnHost).href);
  });

  it("add() percent-encodes a non-Latin-1 path/query (notFoundRedirect)", async () => {
    const { db, inserted } = makeFakeDb("add");
    const service = new DomainsService(db, { nudge } as never);

    await service.add("ws-1", { domain: "fresh.example", notFoundRedirect: cjkPath });

    expect(inserted[0]!.notFoundRedirect).toBe(new URL(cjkPath).href);
    expect(inserted[0]!.notFoundRedirect).not.toBe(cjkPath);
  });

  it("update() persists new URL(value).href for non-Latin-1 redirects", async () => {
    const { db, updated } = makeFakeDb("update");
    const service = new DomainsService(db, { nudge } as never);

    const dto = await service.update(
      "ws-1",
      "019a1b2c-3d4e-7f80-9a1b-2c3d4e5f6a7b",
      { rootRedirect: idnHost, notFoundRedirect: cjkPath },
      actor,
    );

    expect(updated[0]!.rootRedirect).toBe(new URL(idnHost).href);
    expect(updated[0]!.notFoundRedirect).toBe(new URL(cjkPath).href);
    expect(dto.rootRedirect).toBe(new URL(idnHost).href);
    expect(dto.notFoundRedirect).toBe(new URL(cjkPath).href);
  });

  it("a plain ASCII redirect round-trips (equals new URL(value).href)", async () => {
    const { db, inserted } = makeFakeDb("add");
    const service = new DomainsService(db, { nudge } as never);

    await service.add("ws-1", { domain: "fresh.example", rootRedirect: ascii });

    expect(inserted[0]!.rootRedirect).toBe(new URL(ascii).href);
  });

  it("clearing a redirect (null) still stores null", async () => {
    const { db, updated } = makeFakeDb("update");
    const service = new DomainsService(db, { nudge } as never);

    await service.update(
      "ws-1",
      "019a1b2c-3d4e-7f80-9a1b-2c3d4e5f6a7b",
      { rootRedirect: null },
      actor,
    );

    expect(updated[0]).toHaveProperty("rootRedirect", null);
  });

  it("add() with no redirects writes null for both (no normalisation of absent fields)", async () => {
    const { db, inserted } = makeFakeDb("add");
    const service = new DomainsService(db, { nudge } as never);

    await service.add("ws-1", { domain: "fresh.example" });

    expect(inserted[0]!.rootRedirect).toBeNull();
    expect(inserted[0]!.notFoundRedirect).toBeNull();
  });
});
