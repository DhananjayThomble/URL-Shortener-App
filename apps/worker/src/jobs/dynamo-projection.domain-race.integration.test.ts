import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  CreateTableCommand,
  DeleteTableCommand,
  DynamoDBClient,
  waitUntilTableExists,
} from "@aws-sdk/client-dynamodb";
import { DynamoDBDocumentClient, GetCommand } from "@aws-sdk/lib-dynamodb";
import {
  createDatabase,
  domainMetaKey,
  domains,
  eq,
  inArray,
  links,
  projectionOutbox,
  workspaces,
  type Database,
} from "@snapurl/database";
import { DynamoProjection } from "./dynamo-projection.js";
// Namespace import, so a missing export fails ITS test instead of the whole file.
import * as outbox from "./outbox.js";
import type { ProjectionOp } from "./outbox.js";

/* ============================================================
   #713 items 4 + 5, against a REAL Postgres and a REAL (local) DynamoDB.

   Item 4 — a domain delete racing a re-add of the same host.
   Two workers can drain at once, and a crashed worker's claimed rows come back
   after the lease. So a projection write that was RESOLVED from Postgres for an
   old state can land in DynamoDB after a newer one. The DOMAIN-META item is
   keyed by host, not by domain id, so when host H is deleted (domain A) and
   re-added (domain B), any late write about A lands on B's item.

   The interleavings are driven deterministically: the "slow" worker is a real
   DynamoProjection whose DynamoDB client parks every write until the test
   releases it. Nothing is mocked — Postgres and dynamodb-local are real; the
   gate only controls WHEN the slow worker's (real) write is sent.

   Oracle: the Postgres resolver serves a host's root / 404 redirect from the
   `domains` row that owns the host NOW. After all workers finish, the meta
   item must serve what the current row says, never a deleted row's values.

   Item 5 — a live domain with redirects but no links (or whose domain op an
   older worker dropped) has no meta item at all. backfillDomainMeta enqueues a
   domain op for each, and applying those ops projects them.

   Runs only when DATABASE_URL and AWS_ENDPOINT_URL_DYNAMODB are both set.
   ============================================================ */

const DATABASE_URL = process.env.DATABASE_URL;
const ENDPOINT = process.env.AWS_ENDPOINT_URL_DYNAMODB;
const describeLive = DATABASE_URL && ENDPOINT ? describe : describe.skip;

describeLive("#713 domain-meta race + backfill (dynamodb-local + Postgres)", () => {
  const stamp = `${Date.now().toString(36)}${Math.random().toString(16).slice(2, 6)}`;
  const table = `it-domain-race-${stamp}`;
  const workspaceId = randomUUID();
  let handle: ReturnType<typeof createDatabase>;
  let db: Database;
  let raw: DynamoDBClient;
  let doc: DynamoDBDocumentClient;
  /** The healthy worker: writes immediately. */
  let fast: DynamoProjection;
  const createdDomains: string[] = [];

  const domainOp = (domainId: string, host: string): ProjectionOp => ({ linkId: domainId, operation: "domain", host });

  const meta = async (host: string) =>
    (await doc.send(new GetCommand({ TableName: table, Key: domainMetaKey(host), ConsistentRead: true }))).Item;

  /** What the redirect service would serve for the host's root and 404. */
  const served = async (host: string) => {
    const item = await meta(host);
    return { root: item?.rootRedirect ?? null, notFound: item?.notFoundRedirect ?? null };
  };

  const applyOk = async (projection: DynamoProjection, ops: ProjectionOp[]) => {
    const results = await projection.apply(ops);
    expect(results.map((r) => r.ok), JSON.stringify(results)).toEqual(ops.map(() => true));
  };

  /** A worker whose DynamoDB writes are parked until release(). Reads go
   *  straight through, so its Postgres resolution happens immediately — exactly
   *  a worker that read the row and then stalled (GC pause, throttling, a crash
   *  followed by a lease reclaim of an op resolved from the same stale state). */
  const slowWorker = () => {
    let release!: () => void;
    const gate = new Promise<void>((resolve) => (release = resolve));
    let signalParked!: () => void;
    const parked = new Promise<void>((resolve) => (signalParked = resolve));
    const client = {
      send: async (command: unknown) => {
        signalParked();
        await gate;
        return doc.send(command as never);
      },
    } as unknown as DynamoDBDocumentClient;
    return { projection: new DynamoProjection(db, client, table), parked, release };
  };

  const addDomain = async (host: string, values: Partial<typeof domains.$inferInsert> = {}) => {
    const [row] = await db
      .insert(domains)
      .values({ workspaceId, domain: host, status: "live", ...values })
      .returning({ id: domains.id });
    createdDomains.push(row!.id);
    return row!.id;
  };

  beforeAll(async () => {
    handle = createDatabase({ url: DATABASE_URL!, max: 2 });
    db = handle.db;
    raw = new DynamoDBClient({
      endpoint: ENDPOINT,
      region: process.env.AWS_REGION ?? "us-east-1",
      credentials: { accessKeyId: "dummy", secretAccessKey: "dummy" },
    });
    doc = DynamoDBDocumentClient.from(raw);
    await raw.send(
      new CreateTableCommand({
        TableName: table,
        BillingMode: "PAY_PER_REQUEST",
        AttributeDefinitions: [
          { AttributeName: "PK", AttributeType: "S" },
          { AttributeName: "SK", AttributeType: "S" },
          { AttributeName: "linkId", AttributeType: "S" },
        ],
        KeySchema: [
          { AttributeName: "PK", KeyType: "HASH" },
          { AttributeName: "SK", KeyType: "RANGE" },
        ],
        GlobalSecondaryIndexes: [
          {
            IndexName: "linkId-index",
            KeySchema: [{ AttributeName: "linkId", KeyType: "HASH" }],
            Projection: { ProjectionType: "ALL" },
          },
        ],
      }),
    );
    await waitUntilTableExists({ client: raw, maxWaitTime: 30 }, { TableName: table });
    fast = new DynamoProjection(db, doc, table);
    await db.insert(workspaces).values({ id: workspaceId, name: "it", slug: `it-race-${stamp}` });
  });

  afterAll(async () => {
    if (createdDomains.length) {
      await db?.delete(projectionOutbox).where(inArray(projectionOutbox.linkId, createdDomains));
    }
    await db?.delete(links).where(eq(links.workspaceId, workspaceId));
    await db?.delete(workspaces).where(eq(workspaces.id, workspaceId));
    await raw?.send(new DeleteTableCommand({ TableName: table })).catch(() => undefined);
    await handle?.close();
  });

  /* ---------------- item 4 ---------------- */

  it("a reclaimed delete op for the OLD domain does not wipe the re-added domain's redirects", async () => {
    const host = `it-race-del-${stamp}.test`;
    const a = await addDomain(host, { rootRedirect: `https://example.org/a-root-${stamp}` });
    await applyOk(fast, [domainOp(a, host)]);

    // A is disconnected; its domain op is claimed by a worker that then dies.
    await db.delete(domains).where(eq(domains.id, a));

    // H is re-added as a NEW domain B with its own redirects, and projected.
    const b = await addDomain(host, {
      rootRedirect: `https://example.org/b-root-${stamp}`,
      notFoundRedirect: `https://example.org/b-nf-${stamp}`,
    });
    expect(b).not.toBe(a);
    await applyOk(fast, [domainOp(b, host)]);
    expect(await served(host)).toEqual({
      root: `https://example.org/b-root-${stamp}`,
      notFound: `https://example.org/b-nf-${stamp}`,
    });

    // The lease expires and A's delete op is reclaimed and applied.
    await applyOk(fast, [domainOp(a, host)]);

    expect(await served(host)).toEqual({
      root: `https://example.org/b-root-${stamp}`,
      notFound: `https://example.org/b-nf-${stamp}`,
    });
    expect((await meta(host))?.id).toBe(b);
  });

  it("a stalled worker's put for the OLD domain cannot overwrite the re-added domain's meta", async () => {
    const host = `it-race-put-${stamp}.test`;
    const a = await addDomain(host, { rootRedirect: `https://example.org/a-root-${stamp}` });

    // The slow worker resolves A's op from Postgres (A is live), then stalls.
    const slow = slowWorker();
    const pending = slow.projection.apply([domainOp(a, host)]);
    await slow.parked;

    // Meanwhile A is deleted and H re-added as B; a healthy worker projects both.
    await db.delete(domains).where(eq(domains.id, a));
    await applyOk(fast, [domainOp(a, host)]);
    const b = await addDomain(host, { rootRedirect: `https://example.org/b-root-${stamp}` });
    await applyOk(fast, [domainOp(b, host)]);

    // The stale write finally lands. It must be a no-op (and must not fail the
    // row forever: superseded is success).
    slow.release();
    const results = await pending;
    expect(results.map((r) => r.ok)).toEqual([true]);

    expect((await meta(host))?.id).toBe(b);
    expect((await served(host)).root).toBe(`https://example.org/b-root-${stamp}`);
  });

  it("a stalled LINK upsert carrying the OLD domain's meta cannot overwrite the re-added domain's", async () => {
    const host = `it-race-link-${stamp}.test`;
    const a = await addDomain(host, { notFoundRedirect: `https://example.org/a-nf-${stamp}` });
    const linkId = randomUUID();
    await db.insert(links).values({
      id: linkId,
      workspaceId,
      domainId: a,
      slug: `l-${stamp}`,
      destination: "https://example.org/l",
    });

    // The slow worker resolves the link (and A's meta with it), then stalls.
    const slow = slowWorker();
    const pending = slow.projection.apply([{ linkId, operation: "upsert" }]);
    await slow.parked;

    // The link is deleted, then A, then H comes back as B with no 404 redirect.
    await db.delete(links).where(eq(links.id, linkId));
    await db.delete(domains).where(eq(domains.id, a));
    await applyOk(fast, [{ linkId, operation: "delete" }, domainOp(a, host)]);
    const b = await addDomain(host, { rootRedirect: `https://example.org/b-root-${stamp}` });
    await applyOk(fast, [domainOp(b, host)]);

    slow.release();
    await pending;

    // B's meta stands: A's 404 redirect must not reappear on B's host.
    expect((await meta(host))?.id).toBe(b);
    expect(await served(host)).toEqual({ root: `https://example.org/b-root-${stamp}`, notFound: null });
    await applyOk(fast, [{ linkId, operation: "delete" }]);
  });

  it("a stalled put cannot resurrect a DELETED domain's redirects (no re-add)", async () => {
    const host = `it-race-resurrect-${stamp}.test`;
    const a = await addDomain(host, { rootRedirect: `https://example.org/a-root-${stamp}` });
    await applyOk(fast, [domainOp(a, host)]);

    const slow = slowWorker();
    const pending = slow.projection.apply([domainOp(a, host)]);
    await slow.parked;

    // A is disconnected and the delete is projected first.
    await db.delete(domains).where(eq(domains.id, a));
    await applyOk(fast, [domainOp(a, host)]);
    expect(await served(host)).toEqual({ root: null, notFound: null });

    slow.release();
    await pending;

    // The host is gone: nothing may be served for it.
    expect(await served(host)).toEqual({ root: null, notFound: null });
  });

  it("a re-added host still projects normally after the old domain's delete (positive control)", async () => {
    const host = `it-race-readd-${stamp}.test`;
    const a = await addDomain(host, { rootRedirect: `https://example.org/a-root-${stamp}` });
    await applyOk(fast, [domainOp(a, host)]);
    await db.delete(domains).where(eq(domains.id, a));
    await applyOk(fast, [domainOp(a, host)]);
    expect(await served(host)).toEqual({ root: null, notFound: null });

    const b = await addDomain(host, { notFoundRedirect: `https://example.org/b-nf-${stamp}` });
    await applyOk(fast, [domainOp(b, host)]);
    expect(await served(host)).toEqual({ root: null, notFound: `https://example.org/b-nf-${stamp}` });

    // ...and B's later edits and clears still reach the projection.
    await db
      .update(domains)
      .set({ notFoundRedirect: null, rootRedirect: `https://example.org/b-root2-${stamp}`, updatedAt: new Date() })
      .where(eq(domains.id, b));
    await applyOk(fast, [domainOp(b, host)]);
    expect(await served(host)).toEqual({ root: `https://example.org/b-root2-${stamp}`, notFound: null });
  });

  it("a stalled put of an OLDER version of the same domain cannot overwrite a newer one", async () => {
    const host = `it-race-version-${stamp}.test`;
    const a = await addDomain(host, { rootRedirect: `https://example.org/v1-${stamp}` });

    const slow = slowWorker();
    const pending = slow.projection.apply([domainOp(a, host)]);
    await slow.parked;

    // The owner changes the redirect (the API bumps updated_at) and it projects.
    await new Promise((r) => setTimeout(r, 5));
    await db
      .update(domains)
      .set({ rootRedirect: `https://example.org/v2-${stamp}`, updatedAt: new Date() })
      .where(eq(domains.id, a));
    await applyOk(fast, [domainOp(a, host)]);

    slow.release();
    await pending;
    expect((await served(host)).root).toBe(`https://example.org/v2-${stamp}`);
  });

  /* ---------------- item 5 ---------------- */

  it("backfillDomainMeta projects a live, link-less domain whose redirects never reached DynamoDB", async () => {
    expect(typeof (outbox as Record<string, unknown>).backfillDomainMeta).toBe("function");
    const backfill = (outbox as unknown as { backfillDomainMeta: (db: Database) => Promise<number> }).backfillDomainMeta;

    // Pre-#711 data: redirects set, no links, and NO outbox op ever enqueued.
    const hostLive = `it-bf-live-${stamp}.test`;
    const hostVerifying = `it-bf-verifying-${stamp}.test`;
    const hostBare = `it-bf-bare-${stamp}.test`;
    const live = await addDomain(hostLive, {
      rootRedirect: `https://example.org/bf-root-${stamp}`,
      notFoundRedirect: `https://example.org/bf-nf-${stamp}`,
    });
    const verifying = await addDomain(hostVerifying, {
      status: "verifying",
      rootRedirect: `https://example.org/bf-v-${stamp}`,
    });
    const bare = await addDomain(hostBare);
    expect(await meta(hostLive)).toBeUndefined();

    await backfill(db);

    const queued = await db
      .select({ linkId: projectionOutbox.linkId, operation: projectionOutbox.operation, payload: projectionOutbox.payload })
      .from(projectionOutbox)
      .where(inArray(projectionOutbox.linkId, [live, verifying, bare]));
    // Only the live domain with a redirect is enqueued (#719 live-gate respected).
    expect(queued.map((q) => q.linkId)).toEqual([live]);
    expect(queued[0]!.operation).toBe("domain");

    // Applying exactly what was enqueued projects it.
    await applyOk(
      fast,
      queued.map((q) => outbox.toProjectionOp({ link_id: q.linkId, operation: q.operation, payload: q.payload })),
    );
    expect(await served(hostLive)).toEqual({
      root: `https://example.org/bf-root-${stamp}`,
      notFound: `https://example.org/bf-nf-${stamp}`,
    });
    expect(await meta(hostVerifying)).toBeUndefined();
    expect(await meta(hostBare)).toBeUndefined();

    // Idempotent: re-running while that op is still pending enqueues no
    // duplicate. (Counted as PENDING rows: a worker sharing this database, e.g.
    // CI's dynamo-smoke worker, may legitimately drain the first one meanwhile.)
    await backfill(db);
    const again = await db
      .select({ id: projectionOutbox.id, processedAt: projectionOutbox.processedAt })
      .from(projectionOutbox)
      .where(inArray(projectionOutbox.linkId, [live, verifying, bare]));
    expect(again.filter((r) => r.processedAt === null).length).toBeLessThanOrEqual(1);
    expect(again.length).toBeLessThanOrEqual(2);
  });
});
