import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { ConflictException } from "@nestjs/common";
import { bioBlocks, bioPages, createDatabase, domains, eq, workspaces, type Database } from "@snapurl/database";
import { UpsertBioPageInput } from "@snapurl/contract";
import { BioPagesService } from "./bio-pages.service.js";

/* ============================================================
   Bio page addresses on a SHARED (system) domain belong to whichever
   workspace claimed them first.

   Every workspace may publish a bio page on a system domain, so two
   workspaces can name the same (domain, slug). The upsert finds "the page at
   this address" and updates it — that lookup must only ever find the
   caller's OWN page. A page at that address owned by another workspace is a
   taken address: 409, and nothing about the other page may change.

   Runs only when DATABASE_URL is set.
   ============================================================ */

const DATABASE_URL = process.env.DATABASE_URL;
const describeDb = DATABASE_URL ? describe : describe.skip;

describeDb("BioPagesService upsert on a shared domain is scoped to the caller's workspace", () => {
  let handle: ReturnType<typeof createDatabase>;
  let db: Database;
  let service: BioPagesService;

  const stamp = Date.now();
  const sharedDomain = `bio-shared-${stamp}.example.com`;
  const slug = `owner-${stamp}`;
  let ownerWs: string;
  let otherWs: string;
  let sharedDomainId: string;

  const input = (over: Partial<UpsertBioPageInput> = {}) =>
    UpsertBioPageInput.parse({
      domain: sharedDomain,
      slug,
      status: "live",
      profile: { name: "Owner", bio: "Original bio." },
      blocks: [{ kind: "link", title: "Site", href: "https://example.com/owner" }],
      ...over,
    });

  beforeAll(async () => {
    handle = createDatabase({ url: DATABASE_URL!, max: 1 });
    db = handle.db;
    service = new BioPagesService(db);

    const [a] = await db.insert(workspaces).values({ name: "bio owner", slug: `bio-owner-${stamp}` }).returning({ id: workspaces.id });
    const [b] = await db.insert(workspaces).values({ name: "bio other", slug: `bio-other-${stamp}` }).returning({ id: workspaces.id });
    ownerWs = a!.id;
    otherWs = b!.id;
    const [d] = await db
      .insert(domains)
      .values({ workspaceId: null, domain: sharedDomain, isSystem: true, status: "live" })
      .returning({ id: domains.id });
    sharedDomainId = d!.id;

    await service.upsert(ownerWs, input());
  });

  afterAll(async () => {
    if (ownerWs) await db.delete(workspaces).where(eq(workspaces.id, ownerWs));
    if (otherWs) await db.delete(workspaces).where(eq(workspaces.id, otherWs));
    if (sharedDomainId) await db.delete(domains).where(eq(domains.id, sharedDomainId));
    await handle?.close();
  });

  it("refuses another workspace's upsert at a taken shared-domain address with 409", async () => {
    await expect(
      service.upsert(otherWs, input({ status: "draft", profile: { name: "Intruder", bio: "Replaced." }, blocks: [] })),
    ).rejects.toBeInstanceOf(ConflictException);
  });

  it("leaves the owner's page, status and blocks untouched after the refused upsert", async () => {
    const [page] = await db.select().from(bioPages).where(eq(bioPages.workspaceId, ownerWs));
    expect(page).toBeDefined();
    expect(page!.status).toBe("live");
    expect(page!.profileName).toBe("Owner");
    expect(page!.profileBio).toBe("Original bio.");

    const blocks = await db.select().from(bioBlocks).where(eq(bioBlocks.bioPageId, page!.id));
    expect(blocks.map((b) => b.href)).toEqual(["https://example.com/owner"]);

    // And the other workspace owns no page at all.
    expect(await db.select().from(bioPages).where(eq(bioPages.workspaceId, otherWs))).toHaveLength(0);
  });

  it("still lets the owner update its own page", async () => {
    const page = await service.upsert(ownerWs, input({ profile: { name: "Owner", bio: "Edited." } }));
    expect(page.profile.bio).toBe("Edited.");
  });
});
