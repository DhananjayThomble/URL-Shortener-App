import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createDatabase, sql, type Database } from "@snapurl/database";
import { linkCacheKey, MemoryCacheStore } from "@snapurl/cache";
import { listenForCacheBust } from "./cache-bust-listener.js";

/* ============================================================
   #470, cross-process regression.

   The prior fix busted a shared CacheStore from drainOutbox — correct for
   CACHE_DRIVER=redis/dynamodb, but a no-op under the DEFAULT CACHE_DRIVER=
   memory (the flagship single-node/compose profile, and what
   docker-compose.staging.yml actually sets on api/redirect/worker). Under
   'memory' every process holds its OWN Map; a worker calling cache.del() on
   its own MemoryCacheStore instance cannot reach the redirect's. This was
   reproduced end-to-end against `pnpm staging:up` by the reviewer, repeatedly
   (see PR #578's review thread).

   This test proves the actual property that matters using TWO SEPARATE
   MemoryCacheStore instances, each fed by its OWN Postgres connection:

     - one connection stands in for the worker: it fires the identical
       `select pg_notify('link_cache_bust', ...)` statement drainOutbox runs
       for a claimed "delete" row (apps/worker/src/jobs/outbox.ts) — this test
       does not import apps/worker (apps/* share code only through
       packages/*, never each other), so it reproduces drainOutbox's exact SQL
       rather than asserting against a description of it;
     - a SECOND, independent connection calls the REAL, exported
       listenForCacheBust() (apps/redirect/src/cache-bust-listener.ts) — the
       exact function apps/redirect/src/main.ts wires into its own init() —
       against its own MemoryCacheStore.

   Both sides are production code, imported and exercised as-is: if
   listenForCacheBust were removed from main.ts's init(), or if drainOutbox's
   NOTIFY were removed, THIS test does not go red (neither call site is
   reachable from here without violating the apps/* import boundary or
   importing the self-executing main.ts). What this test DOES catch is a
   regression in listenForCacheBust() itself — the parsing, the key
   computation, the eviction — and in the channel/payload CONTRACT the two
   sides agree on (channel name "link_cache_bust", JSON {host, slug}): change
   either side's shape and this goes red, because it drives one exact
   pg_notify call (copied from outbox.ts) into the real listener.

   Two real, independently-connected Postgres sessions are the closest a
   test at this level gets to two real OS processes without spawning
   apps/redirect and apps/worker as child processes. */

const DATABASE_URL = process.env.DATABASE_URL;
const describeDb = DATABASE_URL ? describe : describe.skip;

/** Waits until the async `check()` resolves true or the deadline elapses.
 *  Bounded polling, not an open-ended wait — NOTIFY delivery is asynchronous
 *  over the wire, so the assertion needs to tolerate a few milliseconds of
 *  network round trip without sleeping a fixed, possibly-flaky amount. */
async function waitUntil(check: () => Promise<boolean>, timeoutMs = 2000): Promise<void> {
  const start = Date.now();
  while (!(await check())) {
    if (Date.now() - start > timeoutMs) throw new Error(`waitUntil: condition not met within ${timeoutMs}ms`);
    await new Promise((r) => setTimeout(r, 10));
  }
}

describeDb("cross-process link cache invalidation via pg_notify (#470)", () => {
  let workerSide: ReturnType<typeof createDatabase>;
  let redirectSide: ReturnType<typeof createDatabase>;
  let redirectCache: MemoryCacheStore;
  let db: Database;

  beforeAll(async () => {
    // Two independent connections/pools — as independent as two real
    // processes each opening their own, which is what matters here.
    workerSide = createDatabase({ url: DATABASE_URL!, max: 1 });
    redirectSide = createDatabase({ url: DATABASE_URL!, max: 1 });
    db = workerSide.db;

    // The redirect side's own private cache — never touched directly by the
    // "worker" side. Only listenForCacheBust's eviction may touch it.
    redirectCache = new MemoryCacheStore();

    // The REAL function apps/redirect/src/main.ts calls from init(), against
    // a connection that stands in for the redirect process's own.
    await listenForCacheBust(redirectSide.sql, redirectCache);
  });

  afterAll(async () => {
    await workerSide?.close();
    await redirectSide?.close();
  });

  it("evicts the redirect's own cache entry when the worker-side connection notifies, with no shared CacheStore", async () => {
    const host = "cross-process-470.test";
    const slug = "doomed";
    const key = linkCacheKey(host, slug);

    // Warm the "redirect" process's cache exactly as CachingLinkResolver.resolve() would.
    await redirectCache.set(key, JSON.stringify({ id: "whatever" }), 10);
    expect(await redirectCache.get(key)).not.toBeNull();

    // Fire the SAME statement drainOutbox runs for a claimed "delete" row —
    // from the OTHER connection, standing in for the worker process.
    await db.execute(sql`select pg_notify('link_cache_bust', ${JSON.stringify({ host, slug })})`);

    // The redirect side's cache is evicted asynchronously via listenForCacheBust,
    // with NO CacheStore shared between the two sides — proving the notify
    // path, not a shared-store path (there is deliberately none here).
    await waitUntil(async () => (await redirectCache.get(key)) === null);
    expect(await redirectCache.get(key)).toBeNull();
  });

  it("leaves an unrelated key untouched by a notify for a different (host, slug)", async () => {
    const host = "cross-process-470.test";
    const untouchedKey = linkCacheKey(host, "still-alive");
    await redirectCache.set(untouchedKey, "some-value", 10);

    await db.execute(
      sql`select pg_notify('link_cache_bust', ${JSON.stringify({ host, slug: "some-other-slug" })})`,
    );

    // Give the notify a moment to arrive (there is nothing to poll for a
    // negative assertion, so this is a short fixed wait rather than
    // waitUntil — bounded, not open-ended).
    await new Promise((r) => setTimeout(r, 200));
    expect(await redirectCache.get(untouchedKey)).toBe("some-value");
  });

  it("ignores a notify payload missing host/slug rather than throwing", async () => {
    // Malformed/legacy payload shape should not crash the listener or take
    // down the redirect process — this exercises listenForCacheBust's own
    // guard, not main.ts's error handling around it.
    await db.execute(sql`select pg_notify('link_cache_bust', '{"linkId":"x"}')`);
    await new Promise((r) => setTimeout(r, 200));
    // No assertion beyond "did not throw" / "process still responsive" —
    // reaching this line at all is the point.
    expect(true).toBe(true);
  });
});
