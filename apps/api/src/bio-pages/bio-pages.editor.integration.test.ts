import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { NotFoundException } from "@nestjs/common";
import { bioBlocks, bioPages, createDatabase, domains, eq, workspaces, type Database } from "@snapurl/database";
import { BioPage, UpsertBioPageInput } from "@snapurl/contract";
import { BioPagesService } from "./bio-pages.service.js";

/* ============================================================
   The bio page editor's round trip, against a real Postgres.

   The dashboard editor loads a page with GET /bio-pages, edits it, and saves
   it with PUT /bio-pages — which replaces the whole page. That only works if
   what GET returns is enough to PUT back unchanged. It was not: `BioPage` had
   no `href`, so publishing a page from the dashboard silently wiped every
   block's destination, and every save reset every block's click count to 0.

   Oracles:
   - `BioPage` / `UpsertBioPageInput` in packages/contract/src/workspace.ts.
   - Invariant: GET -> PUT with no edits is a no-op on the page's content.
   - Invariant: a view or click counts against the page a visitor was shown,
     and only a live page counts anything.

   Runs only when DATABASE_URL is set.
   ============================================================ */

const DATABASE_URL = process.env.DATABASE_URL;
const describeDb = DATABASE_URL ? describe : describe.skip;

describeDb("BioPagesService editor round trip and counters", () => {
  let handle: ReturnType<typeof createDatabase>;
  let db: Database;
  let service: BioPagesService;

  let workspaceId: string;
  const stamp = Date.now();
  const domain = `bio-editor-${stamp}.example.com`;
  const slug = `editor-${stamp}`;
  const draftSlug = `editor-draft-${stamp}`;

  /** What the dashboard sends back: the page as GET returned it. */
  function asInput(page: BioPage, over: Partial<UpsertBioPageInput> = {}): UpsertBioPageInput {
    return UpsertBioPageInput.parse({
      domain: page.domain,
      slug: page.slug,
      status: page.status,
      profile: { name: page.profile.name, bio: page.profile.bio },
      blocks: page.blocks.map((b) => ({ id: b.id, kind: b.kind, title: b.title, subtitle: b.subtitle, href: b.href, locked: b.locked })),
      ...over,
    });
  }

  beforeAll(async () => {
    handle = createDatabase({ url: DATABASE_URL!, max: 1 });
    db = handle.db;
    service = new BioPagesService(db);

    const [ws] = await db
      .insert(workspaces)
      .values({ name: "bio editor test", slug: `bio-editor-${stamp}` })
      .returning({ id: workspaces.id });
    workspaceId = ws!.id;
    await db.insert(domains).values({ workspaceId, domain, status: "live", ssl: "active" });

    await service.upsert(
      workspaceId,
      UpsertBioPageInput.parse({
        domain,
        slug,
        status: "draft",
        profile: { name: "Grace Hopper", bio: "Compilers." },
        blocks: [
          { kind: "link", title: "Site", href: "https://example.com/grace" },
          { kind: "social", title: "Follow", href: "https://example.com/social" },
        ],
      }),
    );
    await service.upsert(
      workspaceId,
      UpsertBioPageInput.parse({ domain, slug: draftSlug, status: "draft", profile: { name: "Draft" }, blocks: [] }),
    );
  });

  afterAll(async () => {
    if (workspaceId) await db.delete(workspaces).where(eq(workspaces.id, workspaceId));
    await handle?.close();
  });

  const load = async (s = slug) => (await service.list(workspaceId)).find((p) => p.slug === s)!;

  it("returns each block's href to the dashboard", async () => {
    const page = await load();
    expect(() => BioPage.parse(page)).not.toThrow();
    expect(page.blocks.map((b) => b.href)).toEqual(["https://example.com/grace", "https://example.com/social"]);
  });

  it("publishing what GET returned keeps every href, id and click count", async () => {
    const before = await load();
    await db.update(bioBlocks).set({ clicks: 7 }).where(eq(bioBlocks.id, before.blocks[0]!.id));

    const after = await service.upsert(workspaceId, asInput(before, { status: "live" }));

    expect(after.status).toBe("live");
    expect(after.blocks.map((b) => b.id)).toEqual(before.blocks.map((b) => b.id));
    expect(after.blocks.map((b) => b.href)).toEqual(before.blocks.map((b) => b.href));
    expect(after.blocks[0]!.metric).toBe("7 clicks");
  });

  it("reordering keeps each block's identity and count; a new block starts at zero", async () => {
    const before = await load();
    const [first, second] = before.blocks;
    const input = asInput(before);
    input.blocks = [input.blocks[1]!, input.blocks[0]!, { kind: "email", title: "Newsletter", href: "https://example.com/news", locked: false }];

    const after = await service.upsert(workspaceId, input);

    expect(after.blocks.map((b) => b.id).slice(0, 2)).toEqual([second!.id, first!.id]);
    expect(after.blocks[1]!.metric).toBe("7 clicks");
    expect(after.blocks[2]!.metric).toBeNull();
    expect(after.blocks[2]!.href).toBe("https://example.com/news");
  });

  it("an id that is not one of this page's blocks is treated as a new block", async () => {
    const other = await load(draftSlug);
    const before = await load();
    const input = asInput(other, { blocks: [{ id: before.blocks[0]!.id, kind: "link", title: "Stolen", locked: false }] });

    const after = await service.upsert(workspaceId, input);

    expect(after.blocks[0]!.id).not.toBe(before.blocks[0]!.id);
    // ...and the page it was taken from still has its block.
    expect((await load()).blocks.map((b) => b.id)).toContain(before.blocks[0]!.id);
  });

  it("counts a view and a click on a live page", async () => {
    const before = await load();
    const publicPage = await service.publicPage(slug);
    const block = publicPage.blocks[0]!;
    const clicksBefore = (await db.select().from(bioBlocks).where(eq(bioBlocks.id, block.id)))[0]!.clicks;

    await service.recordView(slug);
    await service.recordClick(slug.toUpperCase(), block.id);

    const after = await load();
    expect(after.views).toBe(before.views + 1);
    const [row] = await db.select().from(bioBlocks).where(eq(bioBlocks.id, block.id));
    expect(row!.clicks).toBe(clicksBefore + 1);
  });

  it("counts nothing for a draft page or a block from another page", async () => {
    await expect(service.recordView(draftSlug)).rejects.toBeInstanceOf(NotFoundException);

    const otherBlock = (await load(draftSlug)).blocks[0]!;
    await expect(service.recordClick(slug, otherBlock.id)).rejects.toBeInstanceOf(NotFoundException);
    await expect(service.recordClick(slug, randomUUID())).rejects.toBeInstanceOf(NotFoundException);

    const [draft] = await db.select().from(bioPages).where(eq(bioPages.slug, draftSlug));
    expect(draft!.views).toBe(0);
  });
});
