import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { bioBlocks, bioPages, createDatabase, domains, eq, workspaces, type Database } from "@snapurl/database";
import { BioPage } from "@snapurl/contract";
import { BioPagesService } from "./bio-pages.service.js";

/* ============================================================
   BioPagesService.list, against a real Postgres (issue #486).

   #486 replaced a string-interpolated sql.raw() value list with the
   parameterized inArray() every other "filter by ids I already queried" call
   in this codebase uses (see links.service.ts:349,878,886). This test is the
   acceptance criterion from that issue: with two or more bio pages in one
   workspace, each page's blocks must still be the right blocks for that page
   — grouping by bioPageId must not regress when the WHERE clause changes from
   raw SQL text to bind parameters.

   Oracle: `BioPage` in packages/contract/src/workspace.ts is the declared
   response shape; block-to-page association is an invariant regardless of
   implementation (qa-oracles.md §1.4) — page A's response must never contain
   page B's blocks.

   Runs only when DATABASE_URL is set.
   ============================================================ */

const DATABASE_URL = process.env.DATABASE_URL;
const describeDb = DATABASE_URL ? describe : describe.skip;

describeDb("BioPagesService.list", () => {
  let handle: ReturnType<typeof createDatabase>;
  let db: Database;
  let service: BioPagesService;

  let workspaceId: string;

  const stamp = Date.now();
  const slugA = `list-a-${stamp}`;
  const slugB = `list-b-${stamp}`;

  beforeAll(async () => {
    handle = createDatabase({ url: DATABASE_URL!, max: 1 });
    db = handle.db;
    service = new BioPagesService(db);

    const [ws] = await db
      .insert(workspaces)
      .values({ name: "bio list test", slug: `bio-list-${stamp}` })
      .returning({ id: workspaces.id });
    workspaceId = ws!.id;

    const [domain] = await db
      .insert(domains)
      .values({ workspaceId, domain: `bio-list-${stamp}.example.com`, status: "live", ssl: "active" })
      .returning({ id: domains.id });
    const domainId = domain!.id;

    const [pageA] = await db
      .insert(bioPages)
      .values({
        workspaceId,
        domainId,
        slug: slugA,
        status: "live",
        profileName: "Page A",
        profileBio: "",
      })
      .returning({ id: bioPages.id });

    const [pageB] = await db
      .insert(bioPages)
      .values({
        workspaceId,
        domainId,
        slug: slugB,
        status: "live",
        profileName: "Page B",
        profileBio: "",
      })
      .returning({ id: bioPages.id });

    await db.insert(bioBlocks).values([
      { bioPageId: pageA!.id, position: 0, kind: "header", title: "A header", clicks: 1 },
      { bioPageId: pageA!.id, position: 1, kind: "link", title: "A link", href: "https://example.com/a", clicks: 2 },
    ]);
    await db.insert(bioBlocks).values([
      { bioPageId: pageB!.id, position: 0, kind: "header", title: "B header", clicks: 3 },
    ]);
  });

  afterAll(async () => {
    if (workspaceId) await db.delete(workspaces).where(eq(workspaces.id, workspaceId));
    await handle?.close();
  });

  it("groups blocks to the right page for two or more pages in one workspace", async () => {
    const pages = await service.list(workspaceId);

    for (const page of pages) {
      expect(() => BioPage.parse(page)).not.toThrow();
    }

    const returnedA = pages.find((p) => p.slug === slugA);
    const returnedB = pages.find((p) => p.slug === slugB);

    expect(returnedA?.blocks.map((b) => b.title)).toEqual(["A header", "A link"]);
    expect(returnedB?.blocks.map((b) => b.title)).toEqual(["B header"]);

    // Page A's blocks must never include page B's, and vice versa.
    expect(returnedA?.blocks.some((b) => b.title === "B header")).toBe(false);
    expect(returnedB?.blocks.some((b) => b.title.startsWith("A "))).toBe(false);
  });
});
