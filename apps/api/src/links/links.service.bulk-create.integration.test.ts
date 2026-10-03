import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createDatabase, domains, eq, links, workspaces, type Database } from "@snapurl/database";
import { LinksService } from "./links.service.js";
import type { SafeBrowsingService } from "../safe-browsing/safe-browsing.service.js";
import type { ProjectionNudgeService } from "./projection-nudge.service.js";
import type { LinkCacheBustService } from "../common/link-cache-bust.service.js";
import { toActor } from "../common/activity.js";

/* ============================================================
   LinksService.bulkCreate against a real Postgres.

   Issue #643: a row whose requested back-half already exists in the database
   used to be treated as a validation problem, which rejected the *entire*
   batch (the all-or-nothing rule) — so re-importing a file that had already
   partially succeeded could never converge, because every previously
   imported row now "collided".

   The oracle here is the import panel's own promise, echoed in the issue:
   "Existing back-halves are skipped, never overwritten" and "import the same
   file again; imported rows won't be duplicated." A collision with an
   existing row must be reported as a skip and must not block the rest of the
   batch from being written. A *genuine* validation problem (bad URL, two new
   rows wanting the same slug) must still reject the whole batch — this suite
   checks both halves so collisions and validation errors are not conflated.
   ============================================================ */

const DATABASE_URL = process.env.DATABASE_URL;
const describeDb = DATABASE_URL ? describe : describe.skip;

const safeBrowsingStub = {
  check: async () => ({ status: "clean" as const, checkedAt: new Date() }),
} as unknown as SafeBrowsingService;

const projectionNudgeStub = { nudge: () => {} } as unknown as ProjectionNudgeService;

const cacheBustStub = { bust: async () => {} } as unknown as LinkCacheBustService;

const actor = toActor({ userId: null, label: "test-harness" });

describeDb("LinksService.bulkCreate — existing-slug collisions are skipped, not all-or-nothing", () => {
  let handle: ReturnType<typeof createDatabase>;
  let db: Database;
  let service: LinksService;
  let workspaceId: string;
  let domainName: string;

  const stamp = Date.now();

  beforeAll(async () => {
    handle = createDatabase({ url: DATABASE_URL!, max: 1 });
    db = handle.db;
    service = new LinksService(db, db, safeBrowsingStub, projectionNudgeStub, cacheBustStub);

    const [ws] = await db
      .insert(workspaces)
      .values({ name: "bulk create test", slug: `bulk-create-${stamp}` })
      .returning({ id: workspaces.id });
    workspaceId = ws!.id;

    domainName = `bulk-create-${stamp}.test`;
    await db.insert(domains).values({ workspaceId, domain: domainName, status: "live", verifiedAt: new Date() });
  });

  afterAll(async () => {
    if (workspaceId) await db.delete(workspaces).where(eq(workspaces.id, workspaceId));
    await handle?.close();
  });

  const row = (slug: string, path = slug) => ({
    destination: `https://example.com/${path}`,
    domain: domainName,
    slug,
    tags: [],
    redirectType: "302",
    rules: [],
    forwardQuery: true,
    deepLink: false,
    hideReferrer: false,
    publicPreview: true,
  });

  it("creates a new row and skips a row whose back-half already exists, in the same batch", async () => {
    const existingSlug = `taken-${stamp}`;
    await db.insert(links).values({
      workspaceId,
      domainId: (await db.select({ id: domains.id }).from(domains).where(eq(domains.domain, domainName)))[0]!.id,
      slug: existingSlug,
      destination: "https://example.com/already-here",
    });

    const newSlug = `fresh-${stamp}`;
    const result = await service.bulkCreate(workspaceId, actor, {
      links: [row(existingSlug), row(newSlug)],
    });

    expect(result.created).toBe(1);
    expect(result.skipped).toBe(1);
    expect(result.failed).toBe(0);
    expect(result.results).toHaveLength(2);

    const [collided, created] = result.results;
    expect(collided).toMatchObject({ ok: false, index: 0, skipped: true });
    expect(created).toMatchObject({ ok: true, index: 1 });
    if (created!.ok) expect(created!.link.slug).toBe(newSlug);

    // The new row actually landed in the database …
    const inDb = await db.select({ slug: links.slug }).from(links).where(eq(links.slug, newSlug));
    expect(inDb).toHaveLength(1);
    // … and the colliding row was never duplicated or overwritten.
    const existingRows = await db.select({ destination: links.destination }).from(links).where(eq(links.slug, existingSlug));
    expect(existingRows).toHaveLength(1);
    expect(existingRows[0]!.destination).toBe("https://example.com/already-here");
  });

  it("re-importing the same file twice converges: second run reports skipped, not failed", async () => {
    const slugA = `conv-a-${stamp}`;
    const slugB = `conv-b-${stamp}`;
    const batch = { links: [row(slugA), row(slugB)] };

    const first = await service.bulkCreate(workspaceId, actor, batch);
    expect(first.created).toBe(2);
    expect(first.skipped).toBe(0);
    expect(first.failed).toBe(0);

    const second = await service.bulkCreate(workspaceId, actor, batch);
    expect(second.created).toBe(0);
    expect(second.skipped).toBe(2);
    expect(second.failed).toBe(0);
    for (const outcome of second.results) {
      expect(outcome.ok).toBe(false);
      if (!outcome.ok) expect(outcome.skipped).toBe(true);
    }

    // Still exactly one row per slug — the second run did not duplicate.
    const rowsA = await db.select({ slug: links.slug }).from(links).where(eq(links.slug, slugA));
    const rowsB = await db.select({ slug: links.slug }).from(links).where(eq(links.slug, slugB));
    expect(rowsA).toHaveLength(1);
    expect(rowsB).toHaveLength(1);
  });

  it("still rejects the whole batch on a genuine validation error, and does not conflate it with a skip", async () => {
    const existingSlug = `taken2-${stamp}`;
    await db.insert(links).values({
      workspaceId,
      domainId: (await db.select({ id: domains.id }).from(domains).where(eq(domains.domain, domainName)))[0]!.id,
      slug: existingSlug,
      destination: "https://example.com/already-here-2",
    });

    const newSlug = `fresh2-${stamp}`;
    const badRow = { ...row("whatever-shape"), destination: "not-a-url" };

    const result = await service.bulkCreate(workspaceId, actor, {
      links: [row(existingSlug), row(newSlug), badRow],
    });

    // One row has a genuine validation problem (bad URL) -> the whole batch
    // is rejected, including the row that would otherwise have been a clean
    // skip and the row that would otherwise have been created.
    expect(result.created).toBe(0);
    expect(result.failed).toBe(3);
    expect(result.results).toHaveLength(3);
    for (const outcome of result.results) {
      expect(outcome.ok).toBe(false);
      // None of these are reported as a skip — rejecting the batch for a
      // genuine error is not the same outcome as a collision skip, even for
      // the row that collides.
      if (!outcome.ok) expect(outcome.skipped).toBeFalsy();
    }

    // Nothing was written for the new row — a genuine error really is
    // all-or-nothing, unlike a plain collision.
    const inDb = await db.select({ slug: links.slug }).from(links).where(eq(links.slug, newSlug));
    expect(inDb).toHaveLength(0);
  });

  it("two new rows asking for the same back-half is a validation error, not a skip, for either row", async () => {
    const slug = `dupe-${stamp}`;
    const result = await service.bulkCreate(workspaceId, actor, {
      links: [row(slug, "a"), row(slug, "b")],
    });

    expect(result.created).toBe(0);
    expect(result.failed).toBe(2);
    for (const outcome of result.results) {
      expect(outcome.ok).toBe(false);
      if (!outcome.ok) expect(outcome.skipped).toBeFalsy();
    }

    const inDb = await db.select({ slug: links.slug }).from(links).where(eq(links.slug, slug));
    expect(inDb).toHaveLength(0);
  });
});
