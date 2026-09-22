import { Inject, Injectable, Logger } from "@nestjs/common";
import { sql, type Database } from "@snapurl/database";
import { createCacheStore, linkCacheKey, type CacheStore } from "@snapurl/cache";
import { DB } from "../database/database.module.js";
import { ENV, type Env } from "../config/env.js";

/* ============================================================
   LinkCacheBustService — immediate redirect-cache invalidation for delete
   (#470) and abuse-flag (#426).

   Earlier attempts at this fix (see #578/#589's review history) fired
   pg_notify('link_cache_bust', ...) from inside the worker's drainOutbox —
   which only runs on the worker's scheduled poll interval
   (PROJECTION_INTERVAL_SECONDS, default 30s). That closed nothing: it just
   moved the bounded-staleness window from "up to LINK_CACHE_TTL_SECONDS" to
   "up to the next poll tick", which is not the accepted fix (both #470 and
   #426's maintainer decisions require the invalidation to be synchronous
   with the write, not with a later scheduled pass).

   This service is called directly by LinksService.remove() and
   ReportsService.review() — the write-side callers — immediately AFTER
   their transaction commits, never from the outbox/worker. Two invalidation
   paths fire together, because no single one covers every CACHE_DRIVER
   profile:

     1. CacheStore.del(linkCacheKey(host, slug)) — reaches the redirect
        directly ONLY when CACHE_DRIVER is 'redis' or 'dynamodb', i.e. an
        actual store shared across processes.
     2. pg_notify('link_cache_bust', {host, slug}) on the API's OWN
        Postgres connection — reaches the redirect in EVERY profile that
        gives it a Postgres connection (i.e. every profile except
        LINK_PROJECTION=dynamo), because NOTIFY is a Postgres server-side
        broadcast, not a shared application store. This is what closes the
        gap (1) cannot: under CACHE_DRIVER=memory (the flagship
        single-node/compose profile) the api and redirect each hold their
        OWN Map, so no application-level store is ever actually shared
        there. apps/redirect/src/cache-bust-listener.ts is the LISTEN side.

   Both are best-effort: a failure here is logged and swallowed, never
   thrown into the caller. The short LINK_CACHE_TTL_SECONDS on the redirect
   remains the final fallback if both are lost (a dropped connection, a
   momentarily unavailable Redis/DynamoDB).
   ============================================================ */

@Injectable()
export class LinkCacheBustService {
  private readonly logger = new Logger(LinkCacheBustService.name);
  private cache: Promise<CacheStore> | undefined;

  constructor(
    @Inject(DB) private readonly db: Database,
    @Inject(ENV) private readonly env: Env,
  ) {}

  /** Bust the hot-link cache entry for exactly (host, slug). Call this AFTER
   *  the caller's transaction has committed — never from inside it: this
   *  fires a NOTIFY other sessions receive before this session's own commit
   *  is guaranteed visible to them if called from within the transaction. */
  async bust(host: string, slug: string): Promise<void> {
    const key = linkCacheKey(host, slug);

    await Promise.all([
      this.db.execute(sql`select pg_notify('link_cache_bust', ${JSON.stringify({ host, slug })})`).catch((err: unknown) => {
        this.logger.warn({ err, host, slug }, "link_cache_bust notify failed");
      }),
      this.getCache()
        .then((cache) => cache.del(key))
        .catch((err: unknown) => {
          this.logger.warn({ err, host, slug }, "link cache bust failed");
        }),
    ]);
  }

  /** Lazily built and memoised, mirroring the throttler's CacheStore factory
   *  in app.module.ts — driver selection is env-driven so this is a genuine
   *  no-op (an in-memory store nothing else reads) on every profile that does
   *  not set CACHE_DRIVER=redis/dynamodb. */
  private getCache(): Promise<CacheStore> {
    this.cache ??= createCacheStore({
      driver: this.env.CACHE_DRIVER,
      redisUrl: this.env.REDIS_URL,
      dynamoTable: this.env.CACHE_DYNAMO_TABLE,
    });
    return this.cache;
  }
}
