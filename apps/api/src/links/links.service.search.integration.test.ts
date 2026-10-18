import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createDatabase, domains, eq, links, workspaces, type Database } from "@snapurl/database";
import { ListLinksQuery } from "@snapurl/contract";
import { LinksService } from "./links.service.js";
import type { SafeBrowsingService } from "../safe-browsing/safe-browsing.service.js";
import type { ProjectionNudgeService } from "./projection-nudge.service.js";
import type { LinkCacheBustService } from "../common/link-cache-bust.service.js";

/* ============================================================
   LinksService.list — the `search` term, against a real Postgres. (#756)

   The top-bar placeholder reads "Search links, slugs, destinations, tags" but
   the predicate only looked at slug, destination and title, so typing a tag
   returned "No matches". Oracle: the placeholder promise plus the issue's
   acceptance criteria — `?search=<tag>` returns links carrying that tag (exact
   and partial), and the result stays workspace-scoped.

   The same term feeds an ILIKE, so a user's `%` or `_` must be matched
   literally rather than as a wildcard: searching "_" must not return every
   link, and "a_b" must not also match "axb".

   Runs only when DATABASE_URL is set — see the note in rollup.test.ts.
   ============================================================ */

const DATABASE_URL = process.env.DATABASE_URL;
const describeDb = DATABASE_URL ? describe : describe.skip;

const safeBrowsingStub = {
  check: async () => ({ status: "clean" as const, checkedAt: new Date().toISOString() }),
} as unknown as SafeBrowsingService;
const projectionNudgeStub = { nudge: () => {} } as unknown as ProjectionNudgeService;
const cacheBustStub = { bust: async () => {} } as unknown as LinkCacheBustService;

const query = (over: Partial<ListLinksQuery> = {}) => ListLinksQuery.parse({ status: "all", ...over });

describeDb("LinksService.list — search by tag (#756)", () => {
  let handle: ReturnType<typeof createDatabase>;
  let db: Database;
  let service: LinksService;
  let workspaceId: string;
  let otherWorkspaceId: string;
  let domainId: string;
  let otherDomainId: string;

  const stamp = Date.now();
  // No `%`, `_` or backslash in any slug or destination below: every wildcard
  // assertion then depends on the TAG column alone.
  const slug = (name: string) => `s${stamp}-${name}`;

  async function addLink(name: string, tags: string[], opts: { archived?: boolean; ws?: "own" | "other" } = {}) {
    const other = opts.ws === "other";
    await db.insert(links).values({
      workspaceId: other ? otherWorkspaceId : workspaceId,
      domainId: other ? otherDomainId : domainId,
      slug: slug(name),
      destination: `https://example.com/${slug(name)}`,
      tags,
      archivedAt: opts.archived ? new Date() : null,
    });
  }

  const found = async (search: string, over: Partial<ListLinksQuery> = {}, ws = workspaceId) =>
    (await service.list(ws, query({ search, ...over }))).items.map((i) => i.slug).sort();
  const slugs = (...names: string[]) => names.map(slug).sort();

  beforeAll(async () => {
    handle = createDatabase({ url: DATABASE_URL!, max: 1 });
    db = handle.db;
    service = new LinksService(db, db, safeBrowsingStub, projectionNudgeStub, cacheBustStub);

    const [ws] = await db
      .insert(workspaces)
      .values({ name: "search test", slug: `search-${stamp}` })
      .returning({ id: workspaces.id });
    workspaceId = ws!.id;
    const [otherWs] = await db
      .insert(workspaces)
      .values({ name: "search test other", slug: `search-other-${stamp}` })
      .returning({ id: workspaces.id });
    otherWorkspaceId = otherWs!.id;

    const [dom] = await db
      .insert(domains)
      .values({ workspaceId, domain: `search-${stamp}.test` })
      .returning({ id: domains.id });
    domainId = dom!.id;
    const [otherDom] = await db
      .insert(domains)
      .values({ workspaceId: otherWorkspaceId, domain: `search-other-${stamp}.test` })
      .returning({ id: domains.id });
    otherDomainId = otherDom!.id;

    await addLink("plain", []);
    await addLink("campaign", ["clqatag", "q3"]);
    await addLink("mixed", ["Promo-Spring"]);
    await addLink("accent", ["café", "日本語"]);
    await addLink("percent", ["100%off"]);
    await addLink("under", ["a_b"]);
    await addLink("under-decoy", ["axb"]);
    await addLink("backslash", ["back\\slash"]);
    await addLink("shelved", ["shelvedtag"], { archived: true });
    await addLink("other", ["othertag", "clqatag"], { ws: "other" });
  });

  afterAll(async () => {
    for (const id of [workspaceId, otherWorkspaceId]) {
      if (id) await db.delete(workspaces).where(eq(workspaces.id, id));
    }
    await handle?.close();
  });

  it("returns the link carrying the exact tag", async () => {
    expect(await found("clqatag")).toEqual(slugs("campaign"));
  });

  it("matches a partial tag", async () => {
    expect(await found("clqa")).toEqual(slugs("campaign"));
    expect(await found("qat")).toEqual(slugs("campaign"));
  });

  it("matches any tag on a multi-tag link, and returns the link once", async () => {
    const result = await service.list(workspaceId, query({ search: "q3" }));
    expect(result.items.map((i) => i.slug)).toEqual(slugs("campaign"));
    expect(result.total).toBe(1);
    // Two different tags of the same link both hit it, still one row.
    const both = await service.list(workspaceId, query({ search: "q" }));
    expect(both.items.filter((i) => i.slug === slug("campaign"))).toHaveLength(1);
  });

  it("is case-insensitive in both directions", async () => {
    expect(await found("CLQATAG")).toEqual(slugs("campaign"));
    expect(await found("promo-spring")).toEqual(slugs("mixed"));
    expect(await found("PROMO")).toEqual(slugs("mixed"));
  });

  it("matches unicode tags, including across case", async () => {
    expect(await found("café")).toEqual(slugs("accent"));
    expect(await found("CAFÉ")).toEqual(slugs("accent"));
    expect(await found("日本")).toEqual(slugs("accent"));
  });

  it("still matches slug and destination (no regression)", async () => {
    expect(await found(slug("campaign"))).toEqual(slugs("campaign"));
    expect(await found(`example.com/${slug("mixed")}`)).toEqual(slugs("mixed"));
  });

  it("treats % in the term literally, not as a wildcard", async () => {
    expect(await found("%")).toEqual(slugs("percent"));
    expect(await found("100%off")).toEqual(slugs("percent"));
    // As a wildcard "1%f" would also match "100%off"; literally it matches nothing.
    expect(await found("1%f")).toEqual([]);
  });

  it("treats _ in the term literally, not as a single-character wildcard", async () => {
    expect(await found("a_b")).toEqual(slugs("under"));
    expect(await found("_")).toEqual(slugs("under"));
  });

  it("treats a backslash in the term literally", async () => {
    expect(await found("\\")).toEqual(slugs("backslash"));
    expect(await found("back\\slash")).toEqual(slugs("backslash"));
    expect(await found("back\\")).toEqual(slugs("backslash"));
  });

  it("does not match a tag that belongs to another workspace", async () => {
    expect(await found("othertag")).toEqual([]);
    // The other workspace's own search finds it, and only its own link for a tag
    // both workspaces use.
    expect(await found("othertag", {}, otherWorkspaceId)).toEqual(slugs("other"));
    expect(await found("clqatag", {}, otherWorkspaceId)).toEqual(slugs("other"));
    expect(await found("clqatag")).toEqual(slugs("campaign"));
  });

  it("handles archived links the way the status filter already does", async () => {
    // Hidden from every tab except Archived — same as a slug search.
    expect(await found("shelvedtag")).toEqual([]);
    expect(await found("shelvedtag", { status: "active" })).toEqual([]);
    expect(await found("shelvedtag", { status: "archived" })).toEqual(slugs("shelved"));
    expect(await found(slug("shelved"))).toEqual([]);
  });

  it("composes with the exact tag filter and other filters", async () => {
    expect(await found("q3", { tag: "clqatag" })).toEqual(slugs("campaign"));
    expect(await found("q3", { tag: "absent" })).toEqual([]);
  });

  it("returns nothing for a term no field contains", async () => {
    expect(await found("zzz-no-such-tag")).toEqual([]);
  });
});
