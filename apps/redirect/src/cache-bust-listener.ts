import type { PgSql } from "@snapurl/database";
import { linkCacheKey, type CacheStore } from "@snapurl/cache";

/* ============================================================
   listenForCacheBust — #470's fix for the single-node/compose profile.

   The worker's drainOutbox busts a shared CacheStore on every deleted link
   (see apps/worker/src/jobs/outbox.ts), but that only reaches THIS process
   when CACHE_DRIVER is 'redis' or 'dynamodb' — an actual shared store. Under
   the default CACHE_DRIVER=memory (the flagship single-node/compose profile,
   and what docker-compose.staging.yml sets on api/redirect/worker), the api,
   worker and redirect each hold their OWN in-memory Map, so nothing the
   worker does to its Map can ever reach this one.

   drainOutbox ALSO fires `pg_notify('link_cache_bust', ...)` for the same
   row, unconditionally. NOTIFY has no such boundary: it is broadcast by the
   Postgres server itself to every session that has LISTENed on the channel,
   regardless of which process opened that session or which CacheStore driver
   is configured. This function is the LISTEN side: it opens a dedicated
   connection (sql.listen() does this internally, with its own
   reconnect/backoff — see the postgres.js docs) and evicts the matching key
   from THIS process's own CacheStore on receipt.

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
 * matching `linkCacheKey(host, slug)` from `cache` whenever a delete
 * notification arrives. Returns once the LISTEN has been registered.
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
