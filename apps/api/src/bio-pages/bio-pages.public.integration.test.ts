import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { NotFoundException } from "@nestjs/common";
import { bioBlocks, bioPages, createDatabase, domains, eq, workspaces, type Database } from "@snapurl/database";
import { PublicBioPage } from "@snapurl/contract";
import { BioPagesService } from "./bio-pages.service.js";

/* ============================================================
   PublicController#bioPage -> BioPagesService.publicPage, against a real
   Postgres (issue #457).

   The gap #457 pins: a bio page can be published from the dashboard, but no
   route lets a signed-out visitor load it. This test drives the anonymous read
   directly (the service is what the @Public() controller route delegates to)
   and asserts the four properties that make it correct — none of which any
   fixtures-mode spec can prove (qa-oracles.md §5).

   Oracle: `PublicBioPage` in packages/contract/src/workspace.ts is the declared
   response shape, and PublicController#form is the existing precedent for the
   slug-existence rule — a draft/missing page 404s rather than revealing it
   exists. Workspace analytics (views, clickThrough, per-block clicks) are NOT
   part of PublicBioPage and must not appear.

   Runs only when DATABASE_URL is set.
   ============================================================ */

const DATABASE_URL = process.env.DATABASE_URL;
const describeDb = DATABASE_URL ? describe : describe.skip;

describeDb("BioPagesService.publicPage", () => {
  let handle: ReturnType<typeof createDatabase>;
  let db: Database;
  let service: BioPagesService;

  let workspaceId: string;
  let otherWorkspaceId: string;

  const stamp = Date.now();
  const liveSlug = `live-${stamp}`;
  const draftSlug = `draft-${stamp}`;

  beforeAll(async () => {
    handle = createDatabase({ url: DATABASE_URL!, max: 1 });
    db = handle.db;
    service = new BioPagesService(db);

    const [ws] = await db
      .insert(workspaces)
      .values({ name: "bio public test", slug: `bio-public-${stamp}` })
      .returning({ id: workspaces.id });
    workspaceId = ws!.id;

    const [other] = await db
      .insert(workspaces)
      .values({ name: "bio public other", slug: `bio-public-other-${stamp}` })
      .returning({ id: workspaces.id });
    otherWorkspaceId = other!.id;

    const [domain] = await db
      .insert(domains)
      .values({ workspaceId, domain: `bio-${stamp}.example.com`, status: "live", ssl: "active" })
      .returning({ id: domains.id });
    const domainId = domain!.id;

    // A published page with a header and a link block.
    const [live] = await db
      .insert(bioPages)
      .values({
        workspaceId,
        domainId,
        slug: liveSlug,
        status: "live",
        profileName: "Ada Lovelace",
        profileBio: "Notes on the Analytical Engine.",
        // Analytics that must NOT cross the public boundary.
        views: 4242,
      })
      .returning({ id: bioPages.id });
    await db.insert(bioBlocks).values([
      { bioPageId: live!.id, position: 0, kind: "header", title: "Ada", subtitle: "Mathematician", clicks: 99 },
      { bioPageId: live!.id, position: 1, kind: "link", title: "My site", subtitle: "Come say hi", href: "https://example.com/ada", clicks: 12 },
    ]);

    // A draft page whose existence must not leak.
    await db.insert(bioPages).values({
      workspaceId,
      domainId,
      slug: draftSlug,
      status: "draft",
      profileName: "Unpublished",
      profileBio: "",
    });
  });

  afterAll(async () => {
    if (workspaceId) await db.delete(workspaces).where(eq(workspaces.id, workspaceId));
    if (otherWorkspaceId) await db.delete(workspaces).where(eq(workspaces.id, otherWorkspaceId));
    await handle?.close();
  });

  it("returns a published page's profile and blocks by slug for an anonymous visitor", async () => {
    const page = await service.publicPage(liveSlug);

    // Contract is the oracle: the response must satisfy PublicBioPage exactly.
    expect(() => PublicBioPage.parse(page)).not.toThrow();

    expect(page.slug).toBe(liveSlug);
    expect(page.profile.name).toBe("Ada Lovelace");
    expect(page.profile.bio).toBe("Notes on the Analytical Engine.");
    expect(page.profile.initials).toBe("AL");

    // Blocks come back in position order, and a link block keeps its href so
    // the page is actually usable.
    expect(page.blocks.map((b) => b.title)).toEqual(["Ada", "My site"]);
    const link = page.blocks.find((b) => b.kind === "link");
    expect(link?.href).toBe("https://example.com/ada");
  });

  it("never leaks workspace analytics through the public shape", async () => {
    const page = await service.publicPage(liveSlug);
    const asRecord = page as unknown as Record<string, unknown>;

    // views / clickThrough / internal id are workspace business, not a
    // visitor's — PublicBioPage does not declare them.
    expect(asRecord.views).toBeUndefined();
    expect(asRecord.clickThrough).toBeUndefined();
    expect(asRecord.id).toBeUndefined();

    for (const block of page.blocks) {
      const b = block as unknown as Record<string, unknown>;
      expect(b.clicks).toBeUndefined();
      expect(b.metric).toBeUndefined();
    }
  });

  it("404s a draft page rather than revealing that the slug exists", async () => {
    await expect(service.publicPage(draftSlug)).rejects.toBeInstanceOf(NotFoundException);
  });

  it("404s a slug that does not exist at all", async () => {
    await expect(service.publicPage(`missing-${randomUUID()}`)).rejects.toBeInstanceOf(NotFoundException);
  });
});
