import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  clickEvents,
  createDatabase,
  domains,
  eq,
  links,
  projectionOutbox,
  sql,
  workspaces,
  type Database,
} from "@snapurl/database";
import { hashForTesting } from "@snapurl/domain";
import { linkCacheKey, MemoryCacheStore } from "@snapurl/cache";
import { drainOutbox, NoProjection, type ProjectionTarget } from "./outbox.js";
import { rollupClicks } from "./rollup.js";

/* ============================================================
   The concurrency properties of the claim, against a real Postgres.

   Issue #282: the old drain claimed rows with SELECT ... FOR UPDATE SKIP
   LOCKED executed via db.execute OUTSIDE a transaction, so postgres.js
   autocommitted the SELECT and released the locks before any row was
   processed — two workers could claim the same rows and double-project.
   The rollup batch claimed with an unlocked `where rolled_up_at is null`
   and relied on a comment for exclusivity, so two rollups could double-count
   the additive click_daily counts.

   These are properties of SQL under real concurrency that no mock can check.
   They run only when DATABASE_URL is set (CI applies the migrations first);
   locally they skip unless you have run `pnpm db:up && pnpm db:migrate`.

   The overlap is created by running two async calls on two SEPARATE pooled
   connections (two createDatabase handles, each max:1) via Promise.all. A
   single shared connection would serialise the two statements and never
   exercise the race, so SKIP LOCKED would have nothing to skip. vitest's
   fileParallelism is off, so the overlap must come from within one test.
   ============================================================ */

const DATABASE_URL = process.env.DATABASE_URL;
const describeDb = DATABASE_URL ? describe : describe.skip;

/** Records each link_id it is asked to project, so double-processing shows up. */
class CountingTarget implements ProjectionTarget {
  readonly seen = new Map<string, number>();
  async upsert(linkId: string): Promise<void> {
    this.seen.set(linkId, (this.seen.get(linkId) ?? 0) + 1);
  }
  async remove(linkId: string): Promise<void> {
    this.seen.set(linkId, (this.seen.get(linkId) ?? 0) + 1);
  }
}

describeDb("drainOutbox under concurrency", () => {
  let handleA: ReturnType<typeof createDatabase>;
  let handleB: ReturnType<typeof createDatabase>;
  let db: Database;
  let workspaceId: string;
  const N = 40;
  const linkIds: string[] = [];

  beforeAll(async () => {
    handleA = createDatabase({ url: DATABASE_URL!, max: 1 });
    handleB = createDatabase({ url: DATABASE_URL!, max: 1 });
    db = handleA.db;

    /* The claim in drainOutbox() is deliberately global — a real worker must
       drain every workspace's pending rows, not just one — so this test's
       "exactly N" assertion only holds if the table is otherwise empty of
       pending work when it seeds its own N rows. `pnpm test` runs every
       project's suite against one shared Postgres (workspace-concurrency=1,
       apps/api before apps/worker), and every link create/update in apps/api's
       own suite leaves an unprocessed projectionOutbox row (see
       LinksService.enqueueProjection) that nothing else ever drains — so by
       the time this file runs, stray rows from unrelated tests are sitting in
       the same table and would be scooped up by the same `limit batchSize`
       claim, pushing the combined processed count above N. Draining them here
       (with a target that is thrown away) makes the table's pending set
       exactly this test's own N by construction, instead of assuming a
       cleanliness the shared-database model does not provide. */
    const flush = new CountingTarget();
    let drained: { processed: number; failed: number };
    do {
      drained = await drainOutbox(db, flush, 500);
    } while (drained.processed + drained.failed > 0);

    const stamp = Date.now();
    const [ws] = await db
      .insert(workspaces)
      .values({ name: "outbox test", slug: `outbox-${stamp}` })
      .returning({ id: workspaces.id });
    workspaceId = ws!.id;

    const [dom] = await db
      .insert(domains)
      .values({ workspaceId, domain: `outbox-${stamp}.test` })
      .returning({ id: domains.id });

    for (let i = 0; i < N; i++) {
      const [link] = await db
        .insert(links)
        .values({ workspaceId, domainId: dom!.id, slug: `o${stamp}-${i}`, destination: `https://example.com/${i}` })
        .returning({ id: links.id });
      linkIds.push(link!.id);
      // One outbox row per link, all pending.
      await db.insert(projectionOutbox).values({
        linkId: link!.id,
        operation: "upsert",
        payload: { linkId: link!.id, operation: "upsert" },
      });
    }
  });

  afterAll(async () => {
    if (workspaceId) await db.delete(workspaces).where(eq(workspaces.id, workspaceId));
    await handleA?.close();
    await handleB?.close();
  });

  it("processes each pending row exactly once across two concurrent drains", async () => {
    const targetA = new CountingTarget();
    const targetB = new CountingTarget();

    /* The whole point: two drains on two connections at the same instant. If
       the claim were not atomic under SKIP LOCKED, both would pick up the same
       rows and some link_id would be projected twice. */
    const [a, b] = await Promise.all([
      drainOutbox(handleA.db, targetA),
      drainOutbox(handleB.db, targetB),
    ]);

    // Every row handled, and the two drains partition the work between them.
    expect(a.processed + b.processed).toBe(N);
    expect(a.failed + b.failed).toBe(0);

    // No link_id appears in both targets, and none appears twice in either.
    const combined = new Map<string, number>();
    for (const target of [targetA, targetB]) {
      for (const [linkId, count] of target.seen) {
        combined.set(linkId, (combined.get(linkId) ?? 0) + count);
      }
    }
    expect(combined.size).toBe(N);
    for (const linkId of linkIds) {
      expect(combined.get(linkId)).toBe(1);
    }

    // Every seeded outbox row is now processed, exactly N of them.
    const [{ n }] = (await db.execute(sql`
      select count(*)::int as n from projection_outbox o
      join links l on l.id = o.link_id
      where l.workspace_id = ${workspaceId}::uuid and o.processed_at is not null
    `)) as unknown as [{ n: number }];
    expect(n).toBe(N);
  });
});

/* #470: a deleted link keeps 302-redirecting for up to LINK_CACHE_TTL_SECONDS
   after DELETE returns 204 and GET returns 404, because nothing busts the
   redirect's hot-link CacheStore entry on delete. drainOutbox now does that
   itself, given a CacheStore and a "delete" row whose payload carries the
   (host, slug) LinksService.remove() wrote. These tests seed the outbox row
   directly (bypassing the API) against a real Postgres, exactly like the
   concurrency suite above, and assert against a real MemoryCacheStore rather
   than a mock, so the assertion is "the exact key CachingLinkResolver would
   have read is gone", not "del() was called with some arguments". */
describeDb("drainOutbox cache invalidation on delete (#470)", () => {
  let handle: ReturnType<typeof createDatabase>;
  let db: Database;
  let workspaceId: string;
  let host: string;

  beforeAll(async () => {
    handle = createDatabase({ url: DATABASE_URL!, max: 1 });
    db = handle.db;

    const stamp = Date.now();
    const [ws] = await db
      .insert(workspaces)
      .values({ name: "outbox cache-bust test", slug: `outbox-cache-${stamp}` })
      .returning({ id: workspaces.id });
    workspaceId = ws!.id;
    host = `outbox-cache-${stamp}.test`;
    await db.insert(domains).values({ workspaceId, domain: host });
  });

  afterAll(async () => {
    if (workspaceId) await db.delete(workspaces).where(eq(workspaces.id, workspaceId));
    await handle?.close();
  });

  /** Seed one pending "delete" outbox row carrying the given (host, slug) in
   *  its payload, matching exactly what LinksService.remove() writes. Uses a
   *  random linkId: the row's own link no longer existing (the real case,
   *  post-delete) must not stop the bust from happening, since drainOutbox
   *  never reads the links table for this. */
  async function seedDeleteRow(slug: string) {
    const linkId = crypto.randomUUID();
    await db.insert(projectionOutbox).values({
      linkId,
      operation: "delete",
      payload: { linkId, operation: "delete", host, slug },
    });
    return linkId;
  }

  it("busts the exact linkCacheKey the redirect's CachingLinkResolver reads, on a delete row", async () => {
    const slug = "doomed";
    const key = linkCacheKey(host, slug);
    const cache = new MemoryCacheStore();
    // Warm the cache exactly as CachingLinkResolver.resolve() would on a hit.
    await cache.set(key, JSON.stringify({ id: "whatever" }), 10);
    expect(await cache.get(key)).not.toBeNull();

    await seedDeleteRow(slug);
    const result = await drainOutbox(db, new NoProjection(), 200, cache);

    expect(result.processed).toBe(1);
    expect(result.failed).toBe(0);
    // The bust reached the SAME store instance a shared CacheStore would be.
    expect(await cache.get(key)).toBeNull();
  });

  it("is a no-op against the cache for an upsert row (no host/slug payload)", async () => {
    const linkId = crypto.randomUUID();
    const key = linkCacheKey(host, "untouched");
    const cache = new MemoryCacheStore();
    await cache.set(key, "some-value", 10);

    await db.insert(projectionOutbox).values({
      linkId,
      operation: "upsert",
      payload: { linkId, operation: "upsert" },
    });
    const result = await drainOutbox(db, new NoProjection(), 200, cache);

    expect(result.processed).toBe(1);
    // upsert carries no cache-invalidation payload (yet — see #426's
    // edit-invalidation half), so the unrelated key is untouched.
    expect(await cache.get(key)).toBe("some-value");
  });

  it("still processes (and does not throw) a delete row when no cache is passed", async () => {
    // Mirrors every pre-#470 caller: drainOutbox(db, target) with no 4th arg.
    await seedDeleteRow("legacy-caller");
    const result = await drainOutbox(db, new NoProjection());

    expect(result.processed).toBe(1);
    expect(result.failed).toBe(0);
  });

  it("marks the row processed even when the cache del() throws, and logs rather than failing the row", async () => {
    const errors: Array<{ obj: Record<string, unknown>; msg: string }> = [];
    const throwingCache = {
      ...new MemoryCacheStore(),
      del: async () => {
        throw new Error("cache unavailable");
      },
    };
    await seedDeleteRow("cache-down");

    const result = await drainOutbox(db, new NoProjection(), 200, throwingCache as any, {
      error: (obj, msg) => errors.push({ obj, msg }),
    });

    // The outbox row's own bookkeeping is unaffected by a cache failure — it
    // is still marked processed, not retried forever over a cache outage.
    expect(result.processed).toBe(1);
    expect(result.failed).toBe(0);
    expect(errors).toHaveLength(1);
    expect(errors[0]!.msg).toContain("cache bust failed");
  });

  /* #470 follow-up: CacheStore.del() above only reaches a process sharing the
     SAME CacheStore instance/backing store — a no-op across processes under
     CACHE_DRIVER=memory (the flagship single-node/compose profile, where the
     worker and redirect are separate processes with separate Maps). This is
     drainOutbox's OTHER half of the fix: a real pg_notify a real, independent
     Postgres LISTEN connection receives, proving the mechanism the redirect's
     listenForCacheBust (apps/redirect/src/cache-bust-listener.ts) relies on
     is actually fired by production drainOutbox — not just documented. */
  it("fires a pg_notify on 'link_cache_bust' for a delete row, received by an independent LISTEN connection", async () => {
    const slug = "notify-me";
    const key = linkCacheKey(host, slug);

    // A SEPARATE connection — standing in for the redirect process — with no
    // CacheStore shared with anything drainOutbox is given below.
    const listener = createDatabase({ url: DATABASE_URL!, max: 1 });
    const received: Array<{ host?: string; slug?: string }> = [];
    try {
      await listener.sql.listen("link_cache_bust", (payload) => {
        received.push(JSON.parse(payload) as { host?: string; slug?: string });
      });

      await seedDeleteRow(slug);
      // No cache passed at all — this proves the notify does not depend on a
      // CacheStore being wired, unlike the del() path above.
      const result = await drainOutbox(db, new NoProjection());
      expect(result.processed).toBe(1);

      // Bounded poll: NOTIFY delivery is async over the wire.
      const start = Date.now();
      while (received.length === 0 && Date.now() - start < 2000) {
        await new Promise((r) => setTimeout(r, 10));
      }
      expect(received).toHaveLength(1);
      expect(received[0]).toEqual({ host, slug });
      // Sanity: this is the exact key CachingLinkResolver/listenForCacheBust computes.
      expect(linkCacheKey(received[0]!.host!, received[0]!.slug!)).toBe(key);
    } finally {
      await listener.close();
    }
  });

  it("marks the row processed even when the pg_notify call throws, and logs rather than failing the row", async () => {
    const errors: Array<{ obj: Record<string, unknown>; msg: string }> = [];
    const linkId = await seedDeleteRow("notify-down");

    /* A thin wrapper around the real `db`: every statement runs for real
       EXCEPT the pg_notify call, which throws — isolating just the notify
       failure path without needing to break the connection outright (which
       would also break the claim/markProcessed statements this same call
       needs to succeed). Drizzle's sql`` template stores its literal
       fragments in queryChunks (not surfaced via toString()), so that is
       what a fake has to inspect to tell the notify statement apart from
       every other query drainOutbox issues in the same call. */
    const isNotifyQuery = (query: unknown): boolean =>
      Array.isArray((query as { queryChunks?: Array<{ value?: string[] }> })?.queryChunks) &&
      (query as { queryChunks: Array<{ value?: string[] }> }).queryChunks.some((chunk) =>
        chunk?.value?.some((v) => v.includes("pg_notify")),
      );
    const flaky: Database = {
      ...db,
      execute: ((query: unknown) => {
        if (isNotifyQuery(query)) throw new Error("notify unavailable");
        return db.execute(query as never);
      }) as Database["execute"],
    } as Database;

    const result = await drainOutbox(flaky, new NoProjection(), 200, undefined, {
      error: (obj, msg) => errors.push({ obj, msg }),
    });

    // The row's own bookkeeping is unaffected by a notify failure — still
    // processed, not retried forever over a transient notify hiccup. The
    // short LINK_CACHE_TTL_SECONDS remains the backstop for this one row.
    expect(result.processed).toBe(1);
    expect(result.failed).toBe(0);
    expect(errors.some((e) => e.msg.includes("notify failed"))).toBe(true);
    expect(errors.some((e) => e.obj.linkId === linkId)).toBe(true);
  });
});

describeDb("rollupClicks under concurrency", () => {
  let handleA: ReturnType<typeof createDatabase>;
  let handleB: ReturnType<typeof createDatabase>;
  let db: Database;
  let workspaceId: string;
  let linkId: string;
  const M = 30;

  /** Yesterday, so the rows sit on one settled UTC day regardless of run time. */
  const day = new Date(Date.now() - 86_400_000);
  const dayKey = day.toISOString().slice(0, 10);
  const at = (hour: number, minute = 0) => {
    const d = new Date(day);
    d.setUTCHours(hour, minute, 0, 0);
    return d;
  };

  beforeAll(async () => {
    handleA = createDatabase({ url: DATABASE_URL!, max: 1 });
    handleB = createDatabase({ url: DATABASE_URL!, max: 1 });
    db = handleA.db;

    const stamp = Date.now();
    const [ws] = await db
      .insert(workspaces)
      .values({ name: "rollup concurrency", slug: `rollupc-${stamp}` })
      .returning({ id: workspaces.id });
    workspaceId = ws!.id;

    const [dom] = await db
      .insert(domains)
      .values({ workspaceId, domain: `rollupc-${stamp}.test` })
      .returning({ id: domains.id });

    const [link] = await db
      .insert(links)
      .values({ workspaceId, domainId: dom!.id, slug: `rc${stamp}`, destination: "https://example.com/rc" })
      .returning({ id: links.id });
    linkId = link!.id;

    /* M distinct, non-bot, non-blocked clicks on one settled UTC day. Distinct
       visitors so uniques is a known set too. */
    await db.insert(clickEvents).values(
      Array.from({ length: M }, (_, i) => ({
        linkId,
        workspaceId,
        occurredAt: at(Math.floor(i / 4), (i % 4) * 15),
        visitorHash: hashForTesting(`visitor-${i}`),
        country: "IN",
        device: "desktop",
        browser: "Chrome",
        isQr: false,
        isBot: false,
        blockedReason: null,
      })),
    );
  });

  afterAll(async () => {
    if (workspaceId) await db.delete(workspaces).where(eq(workspaces.id, workspaceId));
    await handleA?.close();
    await handleB?.close();
  });

  it("counts each click exactly once across two concurrent rollups", async () => {
    /* Two rollups on two connections at once. rollupClicks drains ALL
       unprocessed events globally, so assertions are scoped to the seeded
       link. If the batch claim were not locked, both rollups would fold the
       same clicks into the additive click_daily.clicks and double-count. */
    await Promise.all([rollupClicks(handleA.db), rollupClicks(handleB.db)]);

    const rows = (await db.execute(sql`
      select clicks, uniques from click_daily
      where link_id = ${linkId}::uuid and day = ${dayKey}::date
    `)) as unknown as Array<{ clicks: number; uniques: number }>;

    expect(rows[0]?.clicks).toBe(M);
    expect(rows[0]?.uniques).toBeLessThanOrEqual(rows[0]!.clicks);
  });
});
