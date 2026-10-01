import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { NotFoundException } from "@nestjs/common";
import { createDatabase, domains, eq, linkCounters, links, workspaces, type Database } from "@snapurl/database";
import { CloneLinkInput, ListLinksQuery, UpdateLinkInput } from "@snapurl/contract";
import { LinksService } from "./links.service.js";
import type { SafeBrowsingService } from "../safe-browsing/safe-browsing.service.js";
import type { ProjectionNudgeService } from "./projection-nudge.service.js";
import type { LinkCacheBustService } from "../common/link-cache-bust.service.js";
import { toActor } from "../common/activity.js";

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

/** #394: this suite only exercises list(), which never enqueues a projection
 *  row, so the nudge is never called — a no-op stub is all the constructor
 *  needs. */
const projectionNudgeStub = { nudge: () => {} } as unknown as ProjectionNudgeService;

/** A no-op stub for the suites in this file that call remove() — bust() is
 *  asserted for real in link-cache-bust.integration.test.ts, against a real
 *  CacheStore and a real LISTEN; this file only needs the constructor shape. */
const cacheBustStub = { bust: async () => {} } as unknown as LinkCacheBustService;

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
    // Second arg is the read-only handle. Single-node here, so it is the same
    // db handle as the primary (matches READ_DB === DB when no replica is set).
    service = new LinksService(db, db, safeBrowsingStub, projectionNudgeStub, cacheBustStub);

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

/* ============================================================
   LinksService.get() and the workspace-ownership clause on getFrom() (#430).

   #430's bug-injection run dropped `eq(links.workspaceId, workspaceId)` from
   getFrom()'s where clause and all 169 API tests still passed — get() itself
   had zero direct coverage in this file. These three pin the contract get()
   is supposed to have: the happy path, the not-found shape the rest of this
   file's convention uses (NotFoundException — see the reports.service
   integration suite for the same idiom), and the cross-workspace read this
   suite was missing. The third test is the one that must go red if the
   ownership clause is ever dropped again.

   clone(), update() and remove() are the sibling :id methods the controller
   exposes. clone() and update() call getFrom() first thing, so they share the
   exact code path get()'s cross-workspace test pins; remove() scopes its own
   guard select by workspaceId separately. None had a cross-workspace
   assertion here, so one is added per method in the same style.
   ============================================================ */
describeDb("LinksService.get / clone / update / remove — workspace ownership", () => {
  let handle: ReturnType<typeof createDatabase>;
  let db: Database;
  let service: LinksService;
  let wsA: string;
  let wsB: string;
  let domainA: string;
  let linkAId: string;

  const stamp = Date.now();
  const slugA = `own${stamp}-a`;

  beforeAll(async () => {
    handle = createDatabase({ url: DATABASE_URL!, max: 1 });
    db = handle.db;
    service = new LinksService(db, db, safeBrowsingStub, projectionNudgeStub, cacheBustStub);

    const [a] = await db
      .insert(workspaces)
      .values({ name: "own test A", slug: `own-a-${stamp}` })
      .returning({ id: workspaces.id });
    wsA = a!.id;

    const [b] = await db
      .insert(workspaces)
      .values({ name: "own test B", slug: `own-b-${stamp}` })
      .returning({ id: workspaces.id });
    wsB = b!.id;

    const [dom] = await db
      .insert(domains)
      .values({ workspaceId: wsA, domain: `own-${stamp}.test` })
      .returning({ id: domains.id });
    domainA = dom!.id;

    const [link] = await db
      .insert(links)
      .values({
        workspaceId: wsA,
        domainId: domainA,
        slug: slugA,
        destination: `https://example.com/${slugA}`,
        tags: ["gap-test"],
        folder: "gap-folder",
      })
      .returning({ id: links.id });
    linkAId = link!.id;
    await db.insert(linkCounters).values({ linkId: linkAId, clicks: 3, uniqueClicks: 2 });
  });

  afterAll(async () => {
    if (wsA) await db.delete(workspaces).where(eq(workspaces.id, wsA));
    if (wsB) await db.delete(workspaces).where(eq(workspaces.id, wsB));
    await handle?.close();
  });

  const actor = toActor({ userId: null, label: "qa-gap-test@example.com" });

  describe("get", () => {
    it("returns the link's fields when it belongs to the caller's workspace", async () => {
      const result = await service.get(wsA, linkAId);
      expect(result.id).toBe(linkAId);
      expect(result.slug).toBe(slugA);
      expect(result.destination).toBe(`https://example.com/${slugA}`);
      expect(result.domain).toBe(`own-${stamp}.test`);
      expect(result.tags).toEqual(["gap-test"]);
      expect(result.folder).toBe("gap-folder");
      expect(result.clicks).toBe(3);
      expect(result.uniqueClicks).toBe(2);
    });

    it("throws NotFoundException for an id that does not exist, the same shape as elsewhere in this file", async () => {
      await expect(service.get(wsA, "00000000-0000-0000-0000-000000000000")).rejects.toBeInstanceOf(
        NotFoundException,
      );
    });

    it("throws NotFoundException — not the link — when the id belongs to a different workspace", async () => {
      // This is the assertion that must fail if eq(links.workspaceId, workspaceId)
      // is ever dropped from getFrom(): today a cross-workspace get() 404s.
      await expect(service.get(wsB, linkAId)).rejects.toBeInstanceOf(NotFoundException);
    });
  });

  describe("cross-workspace protection on the sibling :id methods", () => {
    it("clone() does not let workspace B clone workspace A's link", async () => {
      await expect(service.clone(wsB, linkAId, actor, CloneLinkInput.parse({}))).rejects.toBeInstanceOf(
        NotFoundException,
      );
    });

    it("update() does not let workspace B edit workspace A's link", async () => {
      await expect(service.update(wsB, linkAId, actor, UpdateLinkInput.parse({}))).rejects.toBeInstanceOf(
        NotFoundException,
      );
    });

    it("remove() does not let workspace B delete workspace A's link, and the link survives", async () => {
      await expect(service.remove(wsB, linkAId, actor)).rejects.toBeInstanceOf(NotFoundException);

      const stillThere = await db.select({ id: links.id }).from(links).where(eq(links.id, linkAId));
      expect(stillThere).toHaveLength(1);
    });
  });
});

/* ============================================================
   LinksService.remove() — the delete half of the cache-bust fix (#470).

   The oracle: the maintainer decisions on #470 (and #426 for the flag
   trigger) require the redirect's hot-cache entry to be invalidated
   synchronously with the write, not on the worker's later scheduled outbox
   drain (see LinkCacheBustService's header for why the earlier #578/#589
   attempts — which fired pg_notify from inside drainOutbox — did not
   satisfy this). remove() is the write-side caller; this pins that it calls
   cacheBust.bust(host, slug) exactly once, with the deleted link's own
   domain and slug, AFTER the delete has committed — not before, and not at
   all when the delete itself fails.
   ============================================================ */
describeDb("LinksService.remove() — cache-bust trigger", () => {
  let handle: ReturnType<typeof createDatabase>;
  let db: Database;
  let service: LinksService;
  let workspaceId: string;
  let domainHost: string;

  const stamp = Date.now();
  const actor = toActor({ userId: null, label: "cache-bust-test@example.com" });

  beforeAll(async () => {
    handle = createDatabase({ url: DATABASE_URL!, max: 1 });
    db = handle.db;

    const [ws] = await db
      .insert(workspaces)
      .values({ name: "cache bust test", slug: `cachebust-${stamp}` })
      .returning({ id: workspaces.id });
    workspaceId = ws!.id;

    domainHost = `cachebust-${stamp}.test`;
    await db.insert(domains).values({ workspaceId, domain: domainHost });
  });

  afterAll(async () => {
    if (workspaceId) await db.delete(workspaces).where(eq(workspaces.id, workspaceId));
    await handle?.close();
  });

  it("busts exactly (host, slug) for the deleted link, after the delete has committed", async () => {
    const cacheBust = { bust: vi.fn(async () => {}) };
    service = new LinksService(
      db,
      db,
      safeBrowsingStub,
      projectionNudgeStub,
      cacheBust as unknown as LinkCacheBustService,
    );

    const [dom] = await db.select({ id: domains.id }).from(domains).where(eq(domains.domain, domainHost)).limit(1);
    const slug = `cb${stamp}-target`;
    const [link] = await db
      .insert(links)
      .values({ workspaceId, domainId: dom!.id, slug, destination: "https://example.com/target" })
      .returning({ id: links.id });

    await service.remove(workspaceId, link!.id, actor);

    expect(cacheBust.bust).toHaveBeenCalledTimes(1);
    expect(cacheBust.bust).toHaveBeenCalledWith(domainHost, slug);

    // The row is actually gone — bust() firing is not a substitute for the
    // delete itself.
    const stillThere = await db.select({ id: links.id }).from(links).where(eq(links.id, link!.id));
    expect(stillThere).toHaveLength(0);
  });

  it("does not bust when the link does not exist (NotFoundException, nothing to invalidate)", async () => {
    const cacheBust = { bust: vi.fn(async () => {}) };
    service = new LinksService(
      db,
      db,
      safeBrowsingStub,
      projectionNudgeStub,
      cacheBust as unknown as LinkCacheBustService,
    );

    await expect(
      service.remove(workspaceId, "00000000-0000-0000-0000-000000000000", actor),
    ).rejects.toBeInstanceOf(NotFoundException);
    expect(cacheBust.bust).not.toHaveBeenCalled();
  });
});
