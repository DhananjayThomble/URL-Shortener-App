import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { ConflictException, NotFoundException } from "@nestjs/common";
import { createDatabase, domains, eq, links, projectionOutbox, sql, workspaces, type Database } from "@snapurl/database";
import { DomainsService } from "./domains.service.js";

/* ============================================================
   #840 — DELETE /domains/:id: the in-use pre-check is scoped to the
   caller's workspace.

   Oracle: the multi-tenancy invariant (every data query is workspace-scoped;
   another workspace's id is indistinguishable from a non-existent one). So for
   a domain owned by ANOTHER workspace, remove() must answer exactly what it
   answers for a random uuid — the same exception class and the same message —
   whether or not that domain has links on it, and must not delete it.

   Runs only when DATABASE_URL is set.
   ============================================================ */

const DATABASE_URL = process.env.DATABASE_URL;
const describeDb = DATABASE_URL ? describe : describe.skip;

describeDb("DomainsService.remove workspace scoping (#840)", () => {
  let handle: ReturnType<typeof createDatabase>;
  let db: Database;
  let service: DomainsService;

  const stamp = `${Date.now().toString(36)}${Math.random().toString(16).slice(2, 6)}`;
  const own = randomUUID();
  const other = randomUUID();
  let otherWithLinksId: string;
  let otherEmptyId: string;
  let ownWithLinksId: string;
  let ownEmptyId: string;
  let sharedId: string;
  const linkIds: string[] = [];

  /* remove() gains an actor argument in a sibling change; pass one through an
     untyped call so this test compiles against either signature. */
  const actor = { userId: null, label: "admin@example.com" };
  const remove = (workspaceId: string, id: string) =>
    (service.remove as (...args: unknown[]) => Promise<void>).call(service, workspaceId, id, actor);

  /** What remove() rejects with, as {class, message}, for an exact comparison. */
  async function outcome(workspaceId: string, id: string) {
    try {
      await remove(workspaceId, id);
      return { kind: "resolved", message: "" };
    } catch (err) {
      return { kind: (err as Error).constructor.name, message: (err as Error).message };
    }
  }

  const addLink = async (workspaceId: string, domainId: string, n: number) => {
    for (let i = 0; i < n; i++) {
      const id = randomUUID();
      linkIds.push(id);
      await db.insert(links).values({
        id,
        workspaceId,
        domainId,
        slug: `rs-${stamp}-${linkIds.length}`,
        destination: "https://example.com/ok",
      });
    }
  };

  beforeAll(async () => {
    handle = createDatabase({ url: DATABASE_URL!, max: 1 });
    db = handle.db;
    service = new DomainsService(db, { nudge: vi.fn() } as never, { DEFAULT_DOMAIN: "snap.example.com" } as never);

    await db.insert(workspaces).values({ id: own, name: "own", slug: `rs-own-${stamp}` });
    await db.insert(workspaces).values({ id: other, name: "other", slug: `rs-other-${stamp}` });

    const mk = async (workspaceId: string | null, name: string, isSystem = false) => {
      const [row] = await db
        .insert(domains)
        .values({ workspaceId, domain: `${name}-${stamp}.test`, isSystem, status: isSystem ? "live" : "verifying" })
        .returning({ id: domains.id });
      return row!.id;
    };
    otherWithLinksId = await mk(other, "rs-other-links");
    otherEmptyId = await mk(other, "rs-other-empty");
    ownWithLinksId = await mk(own, "rs-own-links");
    ownEmptyId = await mk(own, "rs-own-empty");
    sharedId = await mk(null, "rs-shared", true);

    await addLink(other, otherWithLinksId, 3);
    await addLink(own, ownWithLinksId, 1);
  });

  afterAll(async () => {
    await db.execute(sql`delete from projection_outbox where payload->>'host' like ${`%-${stamp}.test`}`);
    for (const id of linkIds) await db.delete(projectionOutbox).where(eq(projectionOutbox.linkId, id));
    for (const id of linkIds) await db.delete(links).where(eq(links.id, id));
    await db.delete(domains).where(eq(domains.id, sharedId));
    await db.delete(workspaces).where(eq(workspaces.id, own));
    await db.delete(workspaces).where(eq(workspaces.id, other));
    await handle?.close();
  });

  it("another workspace's domain WITH links answers exactly like a non-existent id", async () => {
    const missing = await outcome(own, randomUUID());
    expect(missing.kind).toBe(NotFoundException.name);

    const foreign = await outcome(own, otherWithLinksId);
    expect(foreign).toEqual(missing);
    // The message carries no per-domain detail.
    expect(foreign.message).not.toMatch(/\d/);

    const [still] = await db.select({ id: domains.id }).from(domains).where(eq(domains.id, otherWithLinksId));
    expect(still?.id).toBe(otherWithLinksId);
  });

  it("another workspace's domain with NO links answers exactly like a non-existent id and is not deleted", async () => {
    const missing = await outcome(own, randomUUID());
    expect(await outcome(own, otherEmptyId)).toEqual(missing);
    const [still] = await db.select({ id: domains.id }).from(domains).where(eq(domains.id, otherEmptyId));
    expect(still?.id).toBe(otherEmptyId);
  });

  it("the owner still gets the in-use 409 with its own link count", async () => {
    await expect(remove(own, ownWithLinksId)).rejects.toBeInstanceOf(ConflictException);
    await expect(remove(own, ownWithLinksId)).rejects.toThrow("1 link still use this domain. Move or delete them first.");
    // ...and the owning workspace of the foreign domain still sees ITS count.
    await expect(remove(other, otherWithLinksId)).rejects.toThrow("3 links still use this domain.");
  });

  it("the shared system domain is still refused by name with a 409", async () => {
    await expect(remove(own, sharedId)).rejects.toThrow("That's a shared SnapURL domain — it isn't yours to disconnect.");
  });

  it("the owner can remove its own unused domain", async () => {
    await expect(remove(own, ownEmptyId)).resolves.toBeUndefined();
    const rows = await db.select({ id: domains.id }).from(domains).where(eq(domains.id, ownEmptyId));
    expect(rows).toHaveLength(0);
  });
});
