import type { PgSql } from "@snapurl/database";
import { linkCacheKey, type CacheStore } from "@snapurl/cache";

/* ============================================================
   listenForCacheBust — the single-node/compose half of #470 and #426's
   immediate cache invalidation.

   The API busts a specific link's hot-cache entry right after its delete or
   abuse-flag transaction commits (see apps/api/src/common/link-cache-bust.service.ts).
   Part of that bust is CacheStore.del(), which only reaches THIS process when
   CACHE_DRIVER is 'redis' or 'dynamodb' — an actual shared store. Under the
   default CACHE_DRIVER=memory (the flagship single-node/compose profile, and
   what docker-compose.staging.yml sets on api/redirect/worker), the api and
   redirect each hold their OWN in-memory Map, so nothing the API does to its
   Map can ever reach this one.

   The other part of that bust is `pg_notify('link_cache_bust', ...)`, fired
   from the SAME API transaction, immediately — not from the worker's
   scheduled outbox drain, which would only shorten the window to the next
   poll tick rather than close it. NOTIFY has no per-process-store boundary:
   it is broadcast by the Postgres server itself to every session that has
   LISTENed on the channel, regardless of which process opened that session.
   This function is the LISTEN side: it opens a dedicated connection
   (sql.listen() does this internally, with its own reconnect/backoff — see
   the postgres.js docs) and evicts the matching key from THIS process's own
   CacheStore on receipt.

   Deliberately off the request path: nothing here runs from inside a /:slug
   handler. A missed or delayed notification (a reconnect window, a payload
   that fails to parse) is not fatal — LINK_CACHE_TTL_SECONDS remains the
   backstop, exactly as it was before this existed.
   ============================================================ */

export interface CacheBustLogger {
  warn(obj: Record<string, unknown>, msg: string): void;
}

/**
 * Subscribe to the `link_cache_bust` channel on `client` and evict the
 * matching `linkCacheKey(host, slug)` from `cache` whenever a notification
 * arrives. Returns once the LISTEN has been registered.
 */
export async function listenForCacheBust(
  client: PgSql,
  cache: CacheStore,
  log?: CacheBustLogger,
): Promise<void> {
  await client.listen("link_cache_bust", (payload) => {
    let parsed: { host?: string; slug?: string };
    try {
      parsed = JSON.parse(payload) as { host?: string; slug?: string };
    } catch (err) {
      log?.warn({ err, payload }, "link_cache_bust notify carried unparseable payload");
      return;
    }
    const { host, slug } = parsed;
    if (!host || !slug) return;
    cache.del(linkCacheKey(host, slug)).catch((err: unknown) => {
      log?.warn({ err, host, slug }, "link_cache_bust eviction failed");
    });
  });
}
