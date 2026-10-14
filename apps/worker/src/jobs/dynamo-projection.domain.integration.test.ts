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
  linkKey,
  links,
  workspaces,
  type Database,
} from "@snapurl/database";
import { DynamoProjection } from "./dynamo-projection.js";
import type { ProjectionOp } from "./outbox.js";

/* ============================================================
   #711 review, Blocker-1 — the DOMAIN-META item under LINK_PROJECTION=dynamo,
   against a REAL Postgres and a REAL (local) DynamoDB.

   Oracle (independent of this implementation): the Postgres resolver reads a
   domain's root / 404 redirect straight off the `domains` row, links or no
   links (apps/redirect PostgresLinkResolver.resolveDomain). The DynamoDB
   projection is a projection of that row, so after the API's outbox op for a
   domain is applied, the DOMAIN-META item must equal the row — including for
   a domain with no links, and after its last link was deleted — and must be
   gone once the domain is.

   The ops are built in the exact shape the API enqueues (link_id = the domain
   id, operation 'domain', payload.host) and handed to apply(), the same entry
   point drainOutbox uses. apply() is called directly rather than through a
   drain because the outbox is shared with any worker running against this
   database (staging, CI's dynamo-smoke worker), which would race us for rows.

   Runs only when DATABASE_URL and AWS_ENDPOINT_URL_DYNAMODB are both set —
   i.e. against dynamodb-local, never real AWS.
   ============================================================ */

const DATABASE_URL = process.env.DATABASE_URL;
const ENDPOINT = process.env.AWS_ENDPOINT_URL_DYNAMODB;
const describeLive = DATABASE_URL && ENDPOINT ? describe : describe.skip;

describeLive("DynamoProjection domain-meta (dynamodb-local + Postgres)", () => {
  const stamp = `${Date.now().toString(36)}${Math.random().toString(16).slice(2, 6)}`;
  const table = `it-domain-meta-${stamp}`;
  const workspaceId = randomUUID();
  let handle: ReturnType<typeof createDatabase>;
  let db: Database;
  let raw: DynamoDBClient;
  let doc: DynamoDBDocumentClient;
  let projection: DynamoProjection;

  const hostB = `it-nolinks-${stamp}.test`;
  const hostC = `it-lastlink-${stamp}.test`;
  let domainB: string;
  let domainC: string;
  let linkC: string;

  const domainOp = (domainId: string, host: string): ProjectionOp =>
    ({ linkId: domainId, operation: "domain", host }) as ProjectionOp;

  const meta = async (host: string) =>
    (await doc.send(new GetCommand({ TableName: table, Key: domainMetaKey(host), ConsistentRead: true }))).Item;

  const applyOk = async (ops: ProjectionOp[]) => {
    const results = await projection.apply(ops);
    expect(results.map((r) => r.ok), JSON.stringify(results)).toEqual(ops.map(() => true));
  };

  beforeAll(async () => {
    handle = createDatabase({ url: DATABASE_URL!, max: 1 });
    db = handle.db;
    raw = new DynamoDBClient({
      endpoint: ENDPOINT,
      region: process.env.AWS_REGION ?? "us-east-1",
      credentials: { accessKeyId: "dummy", secretAccessKey: "dummy" },
    });
    doc = DynamoDBDocumentClient.from(raw);
    // The shape CI's dynamo-smoke job (and the CDK stack) creates.
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
    projection = new DynamoProjection(db, doc, table);

    await db.insert(workspaces).values({ id: workspaceId, name: "it", slug: `it-dm-${stamp}` });
    // status 'live' so these meta-projection assertions exercise the live path;
    // #713 item 2 gates NON-live domains to a meta DELETE, covered by a
    // dedicated case below and by the mock-based unit specs.
    const [b] = await db
      .insert(domains)
      .values({ workspaceId, domain: hostB, status: "live" })
      .returning({ id: domains.id });
    domainB = b!.id;
    const [c] = await db
      .insert(domains)
      .values({ workspaceId, domain: hostC, status: "live", notFoundRedirect: `https://example.org/c-nf-${stamp}` })
      .returning({ id: domains.id });
    domainC = c!.id;
    linkC = randomUUID();
    await db.insert(links).values({
      id: linkC,
      workspaceId,
      domainId: domainC,
      slug: `c-${stamp}`,
      destination: "https://example.org/carrier",
    });
  });

  afterAll(async () => {
    await db?.delete(links).where(eq(links.workspaceId, workspaceId));
    await db?.delete(workspaces).where(eq(workspaces.id, workspaceId));
    await raw?.send(new DeleteTableCommand({ TableName: table })).catch(() => undefined);
    await handle?.close();
  });

  it("link-less domain: setting the root redirect projects the meta item", async () => {
    expect(await meta(hostB)).toBeUndefined();
    await db.update(domains).set({ rootRedirect: `https://example.org/b-root-${stamp}` }).where(eq(domains.id, domainB));
    await applyOk([domainOp(domainB, hostB)]);
    expect(await meta(hostB)).toMatchObject({
      id: domainB,
      rootRedirect: `https://example.org/b-root-${stamp}`,
      notFoundRedirect: null,
    });
  });

  it("link-less domain: setting the 404 redirect projects it too", async () => {
    await db.update(domains).set({ notFoundRedirect: `https://example.org/b-nf-${stamp}` }).where(eq(domains.id, domainB));
    await applyOk([domainOp(domainB, hostB)]);
    expect(await meta(hostB)).toMatchObject({
      rootRedirect: `https://example.org/b-root-${stamp}`,
      notFoundRedirect: `https://example.org/b-nf-${stamp}`,
    });
  });

  it("link-less domain: clearing both reaches the projection (revocation)", async () => {
    await db.update(domains).set({ rootRedirect: null, notFoundRedirect: null }).where(eq(domains.id, domainB));
    await applyOk([domainOp(domainB, hostB)]);
    const item = await meta(hostB);
    expect(item?.rootRedirect ?? null).toBeNull();
    expect(item?.notFoundRedirect ?? null).toBeNull();
  });

  it("delete the last link, then clear the 404 redirect: the stale value is gone", async () => {
    // The link projects first, carrying the domain's 404 redirect into meta.
    await applyOk([{ linkId: linkC, operation: "upsert" }]);
    expect(await meta(hostC)).toMatchObject({ notFoundRedirect: `https://example.org/c-nf-${stamp}` });
    expect((await doc.send(new GetCommand({ TableName: table, Key: linkKey(hostC, `c-${stamp}`) }))).Item).toBeDefined();

    // Last link deleted (the API enqueues the link delete and a domain refresh).
    await db.delete(links).where(eq(links.id, linkC));
    await applyOk([{ linkId: linkC, operation: "delete" }, domainOp(domainC, hostC)]);
    expect((await doc.send(new GetCommand({ TableName: table, Key: linkKey(hostC, `c-${stamp}`) }))).Item).toBeUndefined();
    // The domain still exists, so its redirect still applies (as it does on Postgres).
    expect(await meta(hostC)).toMatchObject({ notFoundRedirect: `https://example.org/c-nf-${stamp}` });

    // Now the owner clears it: no link exists to carry the change.
    await db.update(domains).set({ notFoundRedirect: null }).where(eq(domains.id, domainC));
    await applyOk([domainOp(domainC, hostC)]);
    expect((await meta(hostC))?.notFoundRedirect ?? null).toBeNull();
  });

  it("a link upsert and a domain op for the same domain in one batch do not collide", async () => {
    const linkId = randomUUID();
    await db.update(domains).set({ rootRedirect: `https://example.org/c-root-${stamp}` }).where(eq(domains.id, domainC));
    await db.insert(links).values({ id: linkId, workspaceId, domainId: domainC, slug: `c2-${stamp}`, destination: "https://example.org/x" });
    await applyOk([{ linkId, operation: "upsert" }, domainOp(domainC, hostC)]);
    expect(await meta(hostC)).toMatchObject({ rootRedirect: `https://example.org/c-root-${stamp}` });
    await db.delete(links).where(eq(links.id, linkId));
    await applyOk([{ linkId, operation: "delete" }]);
  });

  it("#713 item 2: a non-live (verifying) domain's meta item is deleted, link upsert projects nothing", async () => {
    /* Mirror of #712's read-time `status = 'live'` gate, applied at
       projection-write time (the DynamoLinkResolver carries no status). A
       domain that is live, then regresses to verifying, must have its meta item
       REMOVED and its link items must stop being (re)projected. */
    const hostV = `it-verifying-${stamp}.test`;
    const [v] = await db
      .insert(domains)
      .values({ workspaceId, domain: hostV, status: "live", rootRedirect: `https://example.org/v-root-${stamp}` })
      .returning({ id: domains.id });
    const domainV = v!.id;
    const linkV = randomUUID();
    await db.insert(links).values({
      id: linkV,
      workspaceId,
      domainId: domainV,
      slug: `v-${stamp}`,
      destination: "https://example.org/v",
    });

    // While live: the domain op projects the meta item and the link upserts.
    await applyOk([domainOp(domainV, hostV), { linkId: linkV, operation: "upsert" }]);
    expect(await meta(hostV)).toMatchObject({ rootRedirect: `https://example.org/v-root-${stamp}` });
    expect((await doc.send(new GetCommand({ TableName: table, Key: linkKey(hostV, `v-${stamp}`) }))).Item).toBeDefined();

    // Status regresses to verifying.
    await db.update(domains).set({ status: "verifying" }).where(eq(domains.id, domainV));

    // A re-projected domain op now DELETEs the stale meta item.
    await applyOk([domainOp(domainV, hostV)]);
    expect(await meta(hostV)).toBeUndefined();

    // A re-projected link upsert writes NOTHING (no new LINK item for a
    // non-live domain) and is still marked processed.
    await applyOk([{ linkId: linkV, operation: "upsert" }]);

    await db.delete(links).where(eq(links.id, linkV));
    await db.delete(domains).where(eq(domains.id, domainV));
  });

  it("a disconnected domain's meta item is deleted", async () => {
    await db.update(domains).set({ rootRedirect: `https://example.org/b-again-${stamp}` }).where(eq(domains.id, domainB));
    await applyOk([domainOp(domainB, hostB)]);
    expect(await meta(hostB)).toBeDefined();
    await db.delete(domains).where(eq(domains.id, domainB));
    await applyOk([domainOp(domainB, hostB)]);
    expect(await meta(hostB)).toBeUndefined();
  });
});
