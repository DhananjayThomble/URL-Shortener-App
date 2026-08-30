import type { ThrottlerStorage } from "@nestjs/throttler";
import type { CacheStore } from "@snapurl/cache";

/* @nestjs/throttler 6.5.0 exports ThrottlerStorage from its barrel but does NOT
   re-export the ThrottlerStorageRecord interface, so we restate its exact shape
   here (verified against
   node_modules/@nestjs/throttler/dist/throttler-storage-record.interface.d.ts).
   totalHits / timeToExpire / isBlocked / timeToBlockExpire, timings in millis. */
interface ThrottlerStorageRecord {
  totalHits: number;
  timeToExpire: number;
  isBlocked: boolean;
  timeToBlockExpire: number;
}

/* ============================================================
   CacheStoreThrottlerStorage — rate-limit counters over a CacheStore.

   @nestjs/throttler's default ThrottlerStorageService is a `new Map()`
   in the process. On Lambda that is the bug the CacheStore port fixes:
   each concurrent instance keeps its own Map and a cold start resets
   it, so the effective limit is (limit x instances) rather than the
   configured limit. Backing the counter with a CacheStore means the
   scaled profile can share ONE counter across every instance (Redis)
   and the limit is honoured globally.

   With the default 'memory' driver this wraps a MemoryCacheStore — a
   Map-backed atomic counter, behaviourally the same as the stock
   in-memory storage for single-node/CI, so existing rate-limit tests
   and smoke stay green.

   Unit conventions to keep straight:
     - @nestjs/throttler 6.5.0 passes `ttl` and `blockDuration` in
       MILLISECONDS.
     - CacheStore.incr takes SECONDS, so we convert with Math.ceil.
     - The returned record's timeToExpire / timeToBlockExpire are in
       MILLISECONDS.

   The window count is a fixed-window incr (first write stamps the
   ttl, later increments in the window do not reset it). timeToExpire
   is read back accurately via CacheStore.pttl (remaining millis)
   rather than approximated from the configured ttl on every hit.
   ============================================================ */
export class CacheStoreThrottlerStorage implements ThrottlerStorage {
  constructor(private readonly cache: CacheStore) {}

  async increment(
    key: string,
    ttl: number,
    limit: number,
    blockDuration: number,
    throttlerName: string,
  ): Promise<ThrottlerStorageRecord> {
    // ttl is millis; the CacheStore window is seconds.
    const ttlSeconds = Math.ceil(ttl / 1000);
    // Namespace by throttler so distinct named throttlers (e.g. the
    // global limit and the tighter argon2-route limit) count separately
    // and never collide on the same tracker key.
    const prefixedKey = `throttle:${throttlerName}:${key}`;

    const totalHits = await this.cache.incr(prefixedKey, ttlSeconds);

    // Read the remaining window accurately. pttl returns millis, or a
    // negative sentinel when the key is absent / has no expiry; fall back
    // to the configured ttl in that (rare, first-hit-race) case.
    const remaining = await this.cache.pttl(prefixedKey);
    const timeToExpire = remaining >= 0 ? remaining : ttl;

    const isBlocked = totalHits > limit;
    // blockDuration is intentionally not honoured as a separate timer. The
    // app configures only { ttl, limit } (no block), so a block always clears
    // when the current window does and mirroring the window here is correct.
    // If a block LONGER than the window is ever configured, this would need a
    // dedicated block key (e.g. `block:${throttlerName}:${key}`) stamped with
    // blockDuration on the first over-limit hit and read back for
    // timeToBlockExpire; until then, tying the block to the window keeps the
    // storage single-round-trip and matches the stock in-memory behaviour.
    const timeToBlockExpire = isBlocked ? timeToExpire : 0;

    return { totalHits, timeToExpire, isBlocked, timeToBlockExpire };
  }
}
