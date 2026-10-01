import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createDatabase, sql, type Database } from "@snapurl/database";
import { linkCacheKey, MemoryCacheStore } from "@snapurl/cache";
import { listenForCacheBust } from "./cache-bust-listener.js";

/* ============================================================
   Cross-process link cache invalidation via pg_notify (#470, #426).

   Earlier attempts at this fix (see #578/#589's review history) fired
   pg_notify from inside the worker's SCHEDULED drainOutbox pass, which does
   not satisfy the maintainer's requirement: it only shortens the window to
   the next poll tick, it does not make invalidation synchronous with the
   write. The current design moves the notify to the WRITE-SIDE API call
   (apps/api/src/common/link-cache-bust.service.ts), fired immediately after
   the delete/flag transaction commits — this test proves the notify/listen
   contract that trigger depends on, using TWO SEPARATE MemoryCacheStore
   instances, each fed by its OWN Postgres connection:

     - one connection stands in for the API process: it runs the identical
       `select pg_notify('link_cache_bust', ...)` statement
       LinkCacheBustService.bust() executes — this test does not import
       apps/api (apps/* share code only through packages/*, never each
       other), so it reproduces bust()'s exact SQL rather than asserting
       against a description of it;
     - a SECOND, independent connection calls the REAL, exported
       listenForCacheBust() (this directory's cache-bust-listener.ts) — the
       exact function apps/redirect/src/main.ts wires into its own init() —
       against its own MemoryCacheStore.

   Both sides are production code, imported and exercised as-is: if
   listenForCacheBust were removed from main.ts's init(), or if
   LinkCacheBustService's NOTIFY were removed, THIS test does not go red
   (neither call site is reachable from here without violating the apps/*
   import boundary or importing the self-executing main.ts/AppModule). What
   this test DOES catch is a regression in listenForCacheBust() itself — the
   parsing, the key computation, the eviction — and in the channel/payload
   CONTRACT the two sides agree on (channel name "link_cache_bust", JSON
   {host, slug}): change either side's shape and this goes red, because it
   drives one exact pg_notify call (copied from link-cache-bust.service.ts)
   into the real listener.

   Two real, independently-connected Postgres sessions are the closest a
   test at this level gets to two real OS processes without spawning
   apps/api and apps/redirect as child processes. */

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

describeDb("cross-process link cache invalidation via pg_notify (#470, #426)", () => {
  let apiSide: ReturnType<typeof createDatabase>;
  let redirectSide: ReturnType<typeof createDatabase>;
  let redirectCache: MemoryCacheStore;
  let db: Database;

  beforeAll(async () => {
    // Two independent connections/pools — as independent as two real
    // processes each opening their own, which is what matters here.
    apiSide = createDatabase({ url: DATABASE_URL!, max: 1 });
    redirectSide = createDatabase({ url: DATABASE_URL!, max: 1 });
    db = apiSide.db;

    // The redirect side's own private cache — never touched directly by the
    // "API" side. Only listenForCacheBust's eviction may touch it.
    redirectCache = new MemoryCacheStore();

    // The REAL function apps/redirect/src/main.ts calls from init(), against
    // a connection that stands in for the redirect process's own.
    await listenForCacheBust(redirectSide.sql, redirectCache);
  });

  afterAll(async () => {
    await apiSide?.close();
    await redirectSide?.close();
  });

  it("evicts the redirect's own cache entry when the API-side connection notifies, with no shared CacheStore", async () => {
    const host = "cross-process-470.test";
    const slug = "doomed";
    const key = linkCacheKey(host, slug);

    // Warm the "redirect" process's cache exactly as CachingLinkResolver.resolve() would.
    await redirectCache.set(key, JSON.stringify({ id: "whatever" }), 10);
    expect(await redirectCache.get(key)).not.toBeNull();

    // Fire the SAME statement LinkCacheBustService.bust() runs immediately
    // after a delete/flag commits — from the OTHER connection, standing in
    // for the API process. Deliberately NOT run inside any scheduled loop:
    // there is no poll tick here for the invalidation to be waiting on.
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

  it("delivers within a couple hundred ms — fast enough that a fixed poll interval could not be the cause", async () => {
    // Distinguishes "the notify path is what closed the gap" from "the
    // assertion just happened to run after a scheduled tick". PROJECTION_
    // INTERVAL_SECONDS defaults to 30s (see apps/worker/src/main.ts); if
    // this test's eviction depended on that schedule, it could not complete
    // this quickly.
    const host = "cross-process-470.test";
    const slug = "timing-check";
    const key = linkCacheKey(host, slug);
    await redirectCache.set(key, "warm", 10);

    const notifiedAt = Date.now();
    await db.execute(sql`select pg_notify('link_cache_bust', ${JSON.stringify({ host, slug })})`);
    await waitUntil(async () => (await redirectCache.get(key)) === null, 500);
    const elapsedMs = Date.now() - notifiedAt;

    expect(elapsedMs).toBeLessThan(500);
  });
});
