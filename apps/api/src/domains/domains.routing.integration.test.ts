import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { createDatabase, domains, eq, workspaces, type Database } from "@snapurl/database";
import { Domain } from "@snapurl/contract";
import { DomainsService } from "./domains.service.js";

/* ============================================================
   #784 — GET /domains and POST /domains carry the routing record.

   Oracle: the Domain contract (packages/contract/src/workspace.ts) and the
   deployment's own configuration. The record a customer must create is
   deployment-specific, so it comes from the API's DEFAULT_DOMAIN (the host the
   redirect service answers on in every deploy profile), never from the web
   bundle. Workspace scoping is unchanged: a caller only ever sees its own
   domains plus the shared one.

   Runs only when DATABASE_URL is set.
   ============================================================ */

vi.mock("node:dns/promises", () => ({
  lookup: vi.fn().mockResolvedValue([{ address: "93.184.215.14", family: 4 }]),
  resolveTxt: vi.fn(),
}));

const DATABASE_URL = process.env.DATABASE_URL;
const describeDb = DATABASE_URL ? describe : describe.skip;

describeDb("DomainsService routing record (#784)", () => {
  let handle: ReturnType<typeof createDatabase>;
  let db: Database;
  let service: DomainsService;
  const nudge = vi.fn();
  const stamp = `${Date.now().toString(36)}${Math.random().toString(16).slice(2, 6)}`;
  const own = randomUUID();
  const other = randomUUID();
  const sharedName = `shared-${stamp}.test`;
  let sharedId: string;

  beforeAll(async () => {
    handle = createDatabase({ url: DATABASE_URL!, max: 1 });
    db = handle.db;
    service = new DomainsService(db, { nudge } as never, { DEFAULT_DOMAIN: "Snap.Example.com:443" } as never);
    await db.insert(workspaces).values({ id: own, name: "own", slug: `rt-own-${stamp}` });
    await db.insert(workspaces).values({ id: other, name: "other", slug: `rt-other-${stamp}` });
    const [s] = await db
      .insert(domains)
      .values({ workspaceId: null, domain: sharedName, isSystem: true, status: "live" })
      .returning({ id: domains.id });
    sharedId = s!.id;
  });

  afterAll(async () => {
    await db.delete(domains).where(eq(domains.workspaceId, own));
    await db.delete(domains).where(eq(domains.workspaceId, other));
    await db.delete(domains).where(eq(domains.id, sharedId));
    await db.delete(workspaces).where(eq(workspaces.id, own));
    await db.delete(workspaces).where(eq(workspaces.id, other));
    await handle?.close();
  });

  it("a newly added domain carries the TXT proof AND the CNAME to the deployment's short domain", async () => {
    const added = await service.add(own, { domain: `go-${stamp}.acme.test` });
    expect(added.dns).toMatchObject({ type: "TXT", name: `_snapurl.go-${stamp}.acme.test` });
    expect(added.routing).toEqual({ type: "CNAME", name: `go-${stamp}.acme.test`, value: "snap.example.com", ttl: 300 });
    expect(Domain.safeParse(added).success).toBe(true);
  });

  it("list() keeps the routing record on the workspace's own pending domain", async () => {
    const mine = (await service.list(own)).find((d) => d.domain === `go-${stamp}.acme.test`);
    expect(mine?.routing?.value).toBe("snap.example.com");
  });

  it("the shared domain has no routing record: it IS the target", async () => {
    const shared = (await service.list(own)).find((d) => d.id === sharedId);
    expect(shared?.shared).toBe(true);
    expect(shared?.routing ?? null).toBeNull();
  });

  it("another workspace never sees this workspace's domain or its records", async () => {
    const theirs = await service.list(other);
    expect(theirs.some((d) => d.domain === `go-${stamp}.acme.test`)).toBe(false);
  });
});
