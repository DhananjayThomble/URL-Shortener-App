import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { ConflictException, NotFoundException } from "@nestjs/common";
import {
  and,
  bioPages,
  createDatabase,
  domains,
  eq,
  isNull,
  isUniqueViolation,
  links,
  projectionOutbox,
  workspaces,
  type Database,
} from "@snapurl/database";
import { UpsertBioPageInput } from "@snapurl/contract";
import { makeBioService, type BioServiceHarness } from "./bio-pages.test-harness.js";

/* ============================================================
   #650 — a published bio page is unique per (domain, slug) but was served by
   slug alone, so two workspaces' pages at the same back-half on different
   domains collided. The fix: each PUBLISHED page owns a managed link at
   `<domain>/<slug>` whose destination is the web app's `/b/<domain>/<slug>`.

   These invariants are the acceptance criteria, and none can be proved in
   fixtures mode (they are all about rows and the unique index):

   1. Publishing creates a hidden, read-only managed link at <domain>/<slug>
      pointing to /b/<domain>/<slug>, with a projection-outbox row.
   2. Publishing onto a slug a USER link already holds is a 409 (both
      directions share links_domain_slug_key).
   3. A managed link does not appear in LinksService.list.
   4. Unpublishing (status -> draft) removes the managed link and busts its
      cache entry.
   5. Deleting the page cascades the managed link away and busts its cache.
   6. The slug alias resolves on a SYSTEM domain only; a custom-domain-only
      slug 404s on the alias and must be reached per-domain.

   WEB_ORIGIN is pinned by the harness so the managed destination is exact.

   Runs only when DATABASE_URL is set.
   ============================================================ */

const DATABASE_URL = process.env.DATABASE_URL;
const describeDb = DATABASE_URL ? describe : describe.skip;
const WEB = "https://app.snapurl.test";

describeDb("BioPagesService managed link (#650)", () => {
  let handle: ReturnType<typeof createDatabase>;
  let db: Database;
  let harness: BioServiceHarness;

  let workspaceId: string;
  let customDomainId: string;
  let systemDomainId: string;

  const stamp = Date.now();
  const customDomain = `bio-managed-${stamp}.example.com`;
  const systemDomain = `shared-${stamp}.snap.to`;

  const input = (over: Partial<UpsertBioPageInput> & { domain: string; slug: string }) =>
    UpsertBioPageInput.parse({ profile: { name: "Grace Hopper", bio: "" }, blocks: [], ...over });

  beforeAll(async () => {
    handle = createDatabase({ url: DATABASE_URL!, max: 1 });
    db = handle.db;
    harness = makeBioService(db, WEB);

    const [ws] = await db
      .insert(workspaces)
      .values({ name: "bio managed test", slug: `bio-managed-${stamp}` })
      .returning({ id: workspaces.id });
    workspaceId = ws!.id;

    const [custom] = await db
      .insert(domains)
      .values({ workspaceId, domain: customDomain, status: "live", ssl: "active" })
      .returning({ id: domains.id });
    customDomainId = custom!.id;

    // A shared/system domain (workspaceId null, isSystem true).
    const [system] = await db
      .insert(domains)
      .values({ domain: systemDomain, isSystem: true, status: "live", ssl: "active" })
      .returning({ id: domains.id });
    systemDomainId = system!.id;
  });

  afterAll(async () => {
    if (workspaceId) await db.delete(workspaces).where(eq(workspaces.id, workspaceId));
    if (systemDomainId) await db.delete(domains).where(eq(domains.id, systemDomainId));
    await handle?.close();
  });

  it("publishing creates a hidden managed link to /b/<domain>/<slug> with a projection row", async () => {
    const slug = `pub-${stamp}`;
    const page = await harness.service.upsert(workspaceId, input({ domain: customDomain, slug, status: "live" }));

    const [link] = await db.select().from(links).where(eq(links.managedBioPageId, page.id));
    expect(link).toBeTruthy();
    expect(link!.slug).toBe(slug);
    expect(link!.domainId).toBe(customDomainId);
    expect(link!.destination).toBe(`${WEB}/b/${customDomain}/${slug}`);
    expect(link!.managedBioPageId).toBe(page.id);

    // A projection-outbox upsert row was enqueued, and the cache was busted.
    const outbox = await db.select().from(projectionOutbox).where(eq(projectionOutbox.linkId, link!.id));
    expect(outbox.some((o) => o.operation === "upsert")).toBe(true);
    expect(harness.busted.some((b) => b.host === customDomain && b.slug === slug)).toBe(true);
  });

  it("a DRAFT page owns no managed link", async () => {
    const slug = `draft-${stamp}`;
    const page = await harness.service.upsert(workspaceId, input({ domain: customDomain, slug, status: "draft" }));
    const owned = await db.select().from(links).where(eq(links.managedBioPageId, page.id));
    expect(owned).toHaveLength(0);
  });

  it("publishing onto a slug a USER link already holds is a 409", async () => {
    const slug = `taken-${stamp}`;
    // A user link already occupies this (domain, slug) — not managed.
    await db.insert(links).values({
      workspaceId,
      domainId: customDomainId,
      slug,
      destination: "https://example.com/user-owns-this",
    });

    await expect(
      harness.service.upsert(workspaceId, input({ domain: customDomain, slug, status: "live" })),
    ).rejects.toBeInstanceOf(ConflictException);

    // The user's link is untouched; no managed link was created.
    const [userLink] = await db
      .select()
      .from(links)
      .where(eq(links.slug, slug));
    expect(userLink!.managedBioPageId).toBeNull();
    expect(userLink!.destination).toBe("https://example.com/user-owns-this");
  });

  it("the reverse direction holds: a published bio slug blocks a user link via the unique index", async () => {
    const slug = `reverse-${stamp}`;
    await harness.service.upsert(workspaceId, input({ domain: customDomain, slug, status: "live" }));

    // A raw insert of a user link at the same (domain, slug) must violate
    // links_domain_slug_key — the same index LinksService.create relies on.
    // Drizzle wraps the driver error, so assert via the repo's own
    // isUniqueViolation (which unwraps) rather than matching err.code directly.
    let caught: unknown;
    try {
      await db.insert(links).values({ workspaceId, domainId: customDomainId, slug, destination: "https://example.com/x" });
    } catch (err) {
      caught = err;
    }
    expect(caught).toBeDefined();
    expect(isUniqueViolation(caught)).toBe(true);
  });

  it("unpublishing removes the managed link and busts its cache", async () => {
    const slug = `unpub-${stamp}`;
    const published = await harness.service.upsert(workspaceId, input({ domain: customDomain, slug, status: "live" }));
    expect(await db.select().from(links).where(eq(links.managedBioPageId, published.id))).toHaveLength(1);

    harness.busted.length = 0;
    await harness.service.upsert(workspaceId, input({ domain: customDomain, slug, status: "draft" }));

    expect(await db.select().from(links).where(eq(links.managedBioPageId, published.id))).toHaveLength(0);
    expect(harness.busted.some((b) => b.host === customDomain && b.slug === slug)).toBe(true);
  });

  it("deleting a published page cascades the managed link away and busts its cache", async () => {
    const slug = `del-${stamp}`;
    const page = await harness.service.upsert(workspaceId, input({ domain: customDomain, slug, status: "live" }));
    const [link] = await db.select().from(links).where(eq(links.managedBioPageId, page.id));
    expect(link).toBeTruthy();

    harness.busted.length = 0;
    await harness.service.remove(workspaceId, page.id);

    expect(await db.select().from(links).where(eq(links.id, link!.id))).toHaveLength(0);
    expect(await db.select().from(bioPages).where(eq(bioPages.id, page.id))).toHaveLength(0);
    expect(harness.busted.some((b) => b.host === customDomain && b.slug === slug)).toBe(true);
  });

  it("the slug alias resolves on a system domain but 404s a custom-domain-only slug", async () => {
    const sharedSlug = `shared-${stamp}`;
    const customOnlySlug = `custom-only-${stamp}`;

    await harness.service.upsert(workspaceId, input({ domain: systemDomain, slug: sharedSlug, status: "live" }));
    await harness.service.upsert(workspaceId, input({ domain: customDomain, slug: customOnlySlug, status: "live" }));

    // Alias finds the system-domain page.
    const viaAlias = await harness.service.publicPageBySlug(sharedSlug);
    expect(viaAlias.slug).toBe(sharedSlug);

    // A slug published only on a custom domain is NOT reachable via the bare
    // alias — it must be addressed per-domain.
    await expect(harness.service.publicPageBySlug(customOnlySlug)).rejects.toBeInstanceOf(NotFoundException);
    const perDomain = await harness.service.publicPage(customDomain, customOnlySlug);
    expect(perDomain.slug).toBe(customOnlySlug);
  });

  it("republishing an unchanged live page does not duplicate the managed link", async () => {
    const slug = `idem-${stamp}`;
    const first = await harness.service.upsert(workspaceId, input({ domain: customDomain, slug, status: "live" }));
    await harness.service.upsert(workspaceId, input({ domain: customDomain, slug, status: "live" }));
    const owned = await db.select().from(links).where(eq(links.managedBioPageId, first.id));
    expect(owned).toHaveLength(1);
    expect(owned[0]!.destination).toBe(`${WEB}/b/${customDomain}/${slug}`);
  });

  it("a managed link is excluded by the managed_bio_page_id IS NULL filter the list applies", async () => {
    const slug = `hidden-${stamp}`;
    const userSlug = `visible-${stamp}`;
    const page = await harness.service.upsert(workspaceId, input({ domain: customDomain, slug, status: "live" }));
    await db.insert(links).values({ workspaceId, domainId: customDomainId, slug: userSlug, destination: "https://example.com/v" });

    // This is the exact predicate LinksService.list adds (isNull on
    // managedBioPageId). The managed link must be absent; the user link present.
    const visibleSlugs = (
      await db
        .select({ slug: links.slug })
        .from(links)
        .where(and(eq(links.workspaceId, workspaceId), isNull(links.managedBioPageId)))
    ).map((r) => r.slug);

    expect(visibleSlugs).toContain(userSlug);
    expect(visibleSlugs).not.toContain(slug);
    // ...and the managed link really does exist (so the exclusion is meaningful).
    expect(await db.select().from(links).where(eq(links.managedBioPageId, page.id))).toHaveLength(1);
  });
});
