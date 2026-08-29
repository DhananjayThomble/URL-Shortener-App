import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createDatabase, domains, eq, linkCounters, links, workspaces, type Database } from "@snapurl/database";
import { ListLinksQuery } from "@snapurl/contract";
import { LinksService } from "./links.service.js";
import type { SafeBrowsingService } from "../safe-browsing/safe-browsing.service.js";

/* ============================================================
   LinksService.list against a real Postgres.

   "expiring" and "expired" are derived rather than stored, so the filters are
   raw SQL comparing expires_at and the click limit against now(). That is
   exactly the kind of predicate a mock cannot check: the whole risk is in how
   Postgres evaluates it, and their interaction with the keyset cursor is
   where an off-by-one hides a row from a page forever.

   Runs only when DATABASE_URL is set — see the note in rollup.test.ts.
   ============================================================ */

const DATABASE_URL = process.env.DATABASE_URL;
const describeDb = DATABASE_URL ? describe : describe.skip;

/** list() never calls it; the constructor only needs something shaped right. */
const safeBrowsingStub = {
  check: async () => ({ status: "clean" as const, checkedAt: new Date().toISOString() }),
} as unknown as SafeBrowsingService;

const query = (over: Partial<ListLinksQuery> = {}) => ListLinksQuery.parse({ status: "all", ...over });

describeDb("LinksService.list", () => {
  let handle: ReturnType<typeof createDatabase>;
  let db: Database;
  let service: LinksService;
  let workspaceId: string;
  let domainId: string;

  const stamp = Date.now();
  const slugs = {
    active: `l${stamp}-active`,
    expiring: `l${stamp}-expiring`,
    expired: `l${stamp}-expired`,
    limited: `l${stamp}-limited`,
    archived: `l${stamp}-archived`,
    scheduled: `l${stamp}-scheduled`,
    lapsed: `l${stamp}-lapsed`,
  };

  const inDays = (n: number) => new Date(Date.now() + n * 86_400_000);

  async function addLink(opts: {
    slug: string;
    expiresAt?: Date | null;
    activatesAt?: Date | null;
    clickLimit?: number | null;
    clicks?: number;
    archived?: boolean;
    tags?: string[];
    folder?: string | null;
    createdAt?: Date;
  }) {
    const [row] = await db
      .insert(links)
      .values({
        workspaceId,
        domainId,
        slug: opts.slug,
        destination: `https://example.com/${opts.slug}`,
        expiresAt: opts.expiresAt ?? null,
        activatesAt: opts.activatesAt ?? null,
        clickLimit: opts.clickLimit ?? null,
        archivedAt: opts.archived ? new Date() : null,
        tags: opts.tags ?? [],
        folder: opts.folder ?? null,
        createdAt: opts.createdAt ?? new Date(),
      })
      .returning({ id: links.id });
    // The counters now live in link_counters, keyed by link_id; the click-limit
    // status filters read them through the service's join.
    await db.insert(linkCounters).values({ linkId: row!.id, clicks: opts.clicks ?? 0 });
    return row!.id;
  }

  const slugsOf = (result: { items: Array<{ slug: string }> }) => result.items.map((i) => i.slug);

  beforeAll(async () => {
    handle = createDatabase({ url: DATABASE_URL!, max: 1 });
    db = handle.db;
    service = new LinksService(db, safeBrowsingStub);

    const [ws] = await db
      .insert(workspaces)
      .values({ name: "links test", slug: `links-${stamp}` })
      .returning({ id: workspaces.id });
    workspaceId = ws!.id;

    const [dom] = await db
      .insert(domains)
      .values({ workspaceId, domain: `links-${stamp}.test` })
      .returning({ id: domains.id });
    domainId = dom!.id;

    // Distinct created_at values, oldest first, so the keyset ordering is
    // deterministic rather than depending on insert timing.
    await addLink({ slug: slugs.archived, archived: true, createdAt: new Date(stamp - 7000) });
    /* A window that closed before it opened. deriveStatus ranks expired above
       scheduled, and the SQL filter has to agree — this is the row that catches
       it if it stops agreeing. */
    await addLink({
      slug: slugs.lapsed,
      activatesAt: inDays(10),
      expiresAt: inDays(-2),
      createdAt: new Date(stamp - 6000),
    });
    await addLink({ slug: slugs.scheduled, activatesAt: inDays(5), createdAt: new Date(stamp - 5000) });
    await addLink({ slug: slugs.limited, clickLimit: 10, clicks: 10, createdAt: new Date(stamp - 4000) });
    await addLink({ slug: slugs.expired, expiresAt: inDays(-1), createdAt: new Date(stamp - 3000) });
    await addLink({ slug: slugs.expiring, expiresAt: inDays(3), createdAt: new Date(stamp - 2000) });
    await addLink({
      slug: slugs.active,
      expiresAt: inDays(60),
      tags: ["promo"],
      folder: "campaigns",
      createdAt: new Date(stamp - 1000),
    });
  });

  afterAll(async () => {
    if (workspaceId) await db.delete(workspaces).where(eq(workspaces.id, workspaceId));
    await handle?.close();
  });

  describe("derived status filters", () => {
    it("returns everything except archived links by default", async () => {
      const result = await service.list(workspaceId, query());
      expect(result.total).toBe(6);
      expect(slugsOf(result)).not.toContain(slugs.archived);
    });

    it("returns only archived links for status=archived", async () => {
      const result = await service.list(workspaceId, query({ status: "archived" }));
      expect(slugsOf(result)).toEqual([slugs.archived]);
    });

    it("treats a link past its expiry as expired", async () => {
      const result = await service.list(workspaceId, query({ status: "expired" }));
      expect(slugsOf(result)).toContain(slugs.expired);
      expect(slugsOf(result)).not.toContain(slugs.expiring);
    });

    it("treats a link at its click limit as expired", async () => {
      // Expiry is not only a date: a link that has spent its click limit is
      // just as dead, and the filter has to agree with deriveStatus.
      const result = await service.list(workspaceId, query({ status: "expired" }));
      expect(slugsOf(result)).toContain(slugs.limited);
    });

    it("treats a link expiring inside seven days as expiring, not active", async () => {
      const expiring = await service.list(workspaceId, query({ status: "expiring" }));
      const active = await service.list(workspaceId, query({ status: "active" }));

      expect(slugsOf(expiring)).toEqual([slugs.expiring]);
      expect(slugsOf(active)).not.toContain(slugs.expiring);
    });

    it("counts a far-future expiry as active", async () => {
      const result = await service.list(workspaceId, query({ status: "active" }));
      expect(slugsOf(result)).toEqual([slugs.active]);
    });

    it("treats a link before its activation date as scheduled, not active", async () => {
      const scheduled = await service.list(workspaceId, query({ status: "scheduled" }));
      const active = await service.list(workspaceId, query({ status: "active" }));

      expect(slugsOf(scheduled)).toEqual([slugs.scheduled]);
      expect(slugsOf(active)).not.toContain(slugs.scheduled);
    });

    it("reports a link that expired before it activated as expired, not scheduled", async () => {
      const expired = await service.list(workspaceId, query({ status: "expired" }));
      const scheduled = await service.list(workspaceId, query({ status: "scheduled" }));

      expect(slugsOf(expired)).toContain(slugs.lapsed);
      expect(slugsOf(scheduled)).not.toContain(slugs.lapsed);
    });

    it("never puts a link in two derived buckets at once", async () => {
      // Every non-archived link belongs to exactly one of the four, or the
      // status tabs would double-count and their totals would not add up.
      const buckets = await Promise.all(
        (["active", "scheduled", "expiring", "expired"] as const).map((status) =>
          service.list(workspaceId, query({ status })),
        ),
      );
      const seen = buckets.flatMap(slugsOf);
      expect(new Set(seen).size).toBe(seen.length);
      expect(seen).toHaveLength(6);
    });

    it("excludes archived links from every derived bucket", async () => {
      for (const status of ["active", "scheduled", "expiring", "expired"] as const) {
        const result = await service.list(workspaceId, query({ status }));
        expect(slugsOf(result)).not.toContain(slugs.archived);
      }
    });
  });

  describe("search, tag and folder filters", () => {
    it("matches a slug fragment case-insensitively", async () => {
      const result = await service.list(workspaceId, query({ search: "ACTIVE" }));
      expect(slugsOf(result)).toEqual([slugs.active]);
    });

    it("filters by tag", async () => {
      const result = await service.list(workspaceId, query({ tag: "promo" }));
      expect(slugsOf(result)).toEqual([slugs.active]);
      expect(await service.list(workspaceId, query({ tag: "absent" })).then(slugsOf)).toEqual([]);
    });

    it("filters by folder", async () => {
      const result = await service.list(workspaceId, query({ folder: "campaigns" }));
      expect(slugsOf(result)).toEqual([slugs.active]);
    });
  });

  describe("cursor pagination", () => {
    it("honours the limit and offers a cursor when more remain", async () => {
      const page = await service.list(workspaceId, query({ limit: 2 }));
      expect(page.items).toHaveLength(2);
      expect(page.nextCursor).toBeTruthy();
      // total is the size of the whole filtered set, not of the page.
      expect(page.total).toBe(6);
    });

    it("walks every row exactly once, with no gap and no repeat", async () => {
      /* The failure this guards against is silent: an off-by-one in the
         keyset predicate either skips a link, which then cannot be found by
         paging at all, or repeats one forever. */
      const seen: string[] = [];
      let cursor: string | undefined;

      for (let guard = 0; guard < 20; guard++) {
        const page: { items: Array<{ slug: string }>; nextCursor?: string | null } = await service.list(
          workspaceId,
          query({ limit: 1, ...(cursor ? { cursor } : {}) }),
        );
        seen.push(...slugsOf(page));
        if (!page.nextCursor) break;
        cursor = page.nextCursor;
      }

      expect(seen).toHaveLength(6);
      expect(new Set(seen).size).toBe(6);
      expect(seen).not.toContain(slugs.archived);
    });

    it("returns no cursor on the last page", async () => {
      const page = await service.list(workspaceId, query({ limit: 50 }));
      expect(page.items).toHaveLength(6);
      expect(page.nextCursor ?? null).toBeNull();
    });

    it("keeps the filter applied across pages", async () => {
      // A cursor carries position, not the query. Paging a filtered list must
      // not quietly widen back to everything on page two.
      const first = await service.list(workspaceId, query({ status: "expired", limit: 1 }));
      expect(first.total).toBe(3);
      expect(first.nextCursor).toBeTruthy();

      const across = [...slugsOf(first)];
      let cursor = first.nextCursor!;
      for (let guard = 0; guard < 10; guard++) {
        const page: { items: Array<{ slug: string }>; nextCursor?: string | null } = await service.list(
          workspaceId,
          query({ status: "expired", limit: 1, cursor }),
        );
        across.push(...slugsOf(page));
        if (!page.nextCursor) break;
        cursor = page.nextCursor;
      }

      expect(across.sort()).toEqual([slugs.expired, slugs.limited, slugs.lapsed].sort());
    });

    it("orders newest first", async () => {
      const result = await service.list(workspaceId, query());
      expect(slugsOf(result)).toEqual([
        slugs.active,
        slugs.expiring,
        slugs.expired,
        slugs.limited,
        slugs.scheduled,
        slugs.lapsed,
      ]);
    });
  });

  it("never returns another workspace's links", async () => {
    const [other] = await db
      .insert(workspaces)
      .values({ name: "other", slug: `other-${stamp}` })
      .returning({ id: workspaces.id });
    try {
      const result = await service.list(other!.id, query());
      expect(result.items).toHaveLength(0);
      expect(result.total).toBe(0);
    } finally {
      await db.delete(workspaces).where(eq(workspaces.id, other!.id));
    }
  });
});
