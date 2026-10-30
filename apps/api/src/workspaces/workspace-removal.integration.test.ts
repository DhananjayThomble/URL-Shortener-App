import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { NotFoundException } from "@nestjs/common";
import { createDatabase, domains, eq, inArray, links, projectionOutbox, workspaces, type Database } from "@snapurl/database";
import { UpsertBioPageInput } from "@snapurl/contract";
import type { LinkCacheBustService } from "../common/link-cache-bust.service.js";
import type { ProjectionNudgeService } from "../links/projection-nudge.service.js";
import { makeBioService } from "../bio-pages/bio-pages.test-harness.js";
import { WorkspaceRemovalService } from "./workspace-removal.service.js";

/* ============================================================
   #738 — links.workspace_id cascades on workspace delete, which used to drop
   link rows with no projection-outbox DELETE and no cache bust, leaving a
   projected link redirecting from DynamoDB / edge KVS.

   Oracles: the issue's acceptance criteria, not the implementation:
     - after a workspace is removed, EVERY one of its links (ordinary and
       #650 managed) has a pending `delete` projection_outbox row and its
       (host, slug) cache entry is busted;
     - a RAW `DELETE FROM workspaces` (the cascade nobody routed through the
       service) is also covered, by the links DELETE trigger from migration
       0021;
     - the trigger adds nothing for a delete that already enqueued its own row.

   Runs only when DATABASE_URL is set.
   ============================================================ */

const DATABASE_URL = process.env.DATABASE_URL;
const describeDb = DATABASE_URL ? describe : describe.skip;

describeDb("workspace deletion keeps the redirect store in step (#738)", () => {
  let handle: ReturnType<typeof createDatabase>;
  let db: Database;
  const stamp = `${Date.now().toString(36)}${Math.random().toString(16).slice(2, 6)}`;
  const createdWorkspaces: string[] = [];

  const busted: Array<{ host: string; slug: string }> = [];
  let nudges = 0;
  let service: WorkspaceRemovalService;

  async function seedWorkspace(tag: string) {
    const [ws] = await db.insert(workspaces).values({ name: tag, slug: `${tag}-${stamp}` }).returning({ id: workspaces.id });
    createdWorkspaces.push(ws!.id);
    const host = `${tag}-${stamp}.test`;
    const [dom] = await db
      .insert(domains)
      .values({ workspaceId: ws!.id, domain: host, status: "live", ssl: "active" })
      .returning({ id: domains.id });
    const linkIds = [randomUUID(), randomUUID()];
    await db.insert(links).values(
      linkIds.map((id, i) => ({ id, workspaceId: ws!.id, domainId: dom!.id, slug: `s${i}-${stamp}`, destination: "https://example.org/x" })),
    );
    return { workspaceId: ws!.id, domainId: dom!.id, host, linkIds };
  }

  const pendingDeletes = (ids: string[]) =>
    db.select().from(projectionOutbox).where(inArray(projectionOutbox.linkId, ids));

  beforeAll(() => {
    handle = createDatabase({ url: DATABASE_URL!, max: 1 });
    db = handle.db;
    const cacheBust = { bust: async (host: string, slug: string) => void busted.push({ host, slug }) } as unknown as LinkCacheBustService;
    const nudge = { nudge: () => void (nudges += 1) } as unknown as ProjectionNudgeService;
    service = new WorkspaceRemovalService(db, cacheBust, nudge);
  });

  afterAll(async () => {
    if (createdWorkspaces.length) await db.delete(workspaces).where(inArray(workspaces.id, createdWorkspaces));
    await handle?.close();
  });

  it("remove() enqueues a projection DELETE and busts the cache for every link, then deletes the workspace", async () => {
    const seeded = await seedWorkspace("svc");
    busted.length = 0;
    const nudgesBefore = nudges;

    const result = await service.remove(seeded.workspaceId);

    expect(result.linksRemoved).toBe(2);
    expect(await db.select().from(workspaces).where(eq(workspaces.id, seeded.workspaceId))).toHaveLength(0);
    expect(await db.select().from(links).where(inArray(links.id, seeded.linkIds))).toHaveLength(0);

    const rows = await pendingDeletes(seeded.linkIds);
    for (const id of seeded.linkIds) {
      expect(rows.filter((r) => r.linkId === id && r.operation === "delete" && r.processedAt === null)).toHaveLength(1);
    }
    // The workspace's custom domain's meta item is refreshed too (worker deletes it: the row is gone).
    const domainOps = await pendingDeletes([seeded.domainId]);
    expect(domainOps.some((r) => r.operation === "domain")).toBe(true);

    expect(busted.map((b) => `${b.host}/${b.slug}`).sort()).toEqual(
      seeded.linkIds.map((_, i) => `${seeded.host}/s${i}-${stamp}`).sort(),
    );
    expect(nudges).toBeGreaterThan(nudgesBefore);
  });

  it("remove() also covers a #650 managed bio link", async () => {
    const seeded = await seedWorkspace("bio");
    const harness = makeBioService(db);
    const page = await harness.service.upsert(
      seeded.workspaceId,
      UpsertBioPageInput.parse({ domain: seeded.host, slug: `bio-${stamp}`, status: "live", profile: { name: "A", bio: "" }, blocks: [] }),
    );
    const [managed] = await db.select().from(links).where(eq(links.managedBioPageId, page.id));
    expect(managed).toBeTruthy();
    busted.length = 0;

    await service.remove(seeded.workspaceId);

    expect(await db.select().from(links).where(eq(links.id, managed!.id))).toHaveLength(0);
    const rows = await pendingDeletes([managed!.id]);
    expect(rows.some((r) => r.operation === "delete" && r.processedAt === null)).toBe(true);
    expect(busted).toContainEqual({ host: seeded.host, slug: `bio-${stamp}` });
  });

  it("remove() on an unknown workspace is a 404 and writes nothing", async () => {
    await expect(service.remove(randomUUID())).rejects.toBeInstanceOf(NotFoundException);
  });

  it("GUARD: a raw DELETE FROM workspaces (cascade) still enqueues a projection DELETE per link", async () => {
    const seeded = await seedWorkspace("raw");

    await db.delete(workspaces).where(eq(workspaces.id, seeded.workspaceId));

    expect(await db.select().from(links).where(inArray(links.id, seeded.linkIds))).toHaveLength(0);
    const rows = await pendingDeletes(seeded.linkIds);
    for (const id of seeded.linkIds) {
      expect(rows.filter((r) => r.linkId === id && r.operation === "delete" && r.processedAt === null)).toHaveLength(1);
    }
  });

  it("GUARD: a link delete that already enqueued its own DELETE row gets no duplicate", async () => {
    const seeded = await seedWorkspace("dup");
    const id = seeded.linkIds[0]!;
    await db.insert(projectionOutbox).values({ linkId: id, operation: "delete", payload: { linkId: id, operation: "delete" } });

    await db.delete(links).where(eq(links.id, id));

    expect(await pendingDeletes([id])).toHaveLength(1);
  });
});
