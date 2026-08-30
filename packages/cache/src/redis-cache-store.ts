import type { Redis } from "ioredis";
import {
  createSketch,
  deserialize,
  estimate,
  merge,
  serialize,
} from "@snapurl/domain";
import type { CacheStore } from "./cache-store.js";

/* ============================================================
   RedisCacheStore — the scaled-profile adapter (ioredis 6.0.0).

   Redis is the most portable scaling primitive there is for a
   self-hostable product: one container, runs anywhere, and it
   covers caching, counters and sketch merging at once. This
   adapter takes an ioredis client via its constructor so tests
   can inject a mock and no live server is required to unit-test
   the command shapes.

   Two design choices are worth stating:

     - incr uses a Lua script, not INCR followed by EXPIRE. A
       plain INCR then EXPIRE has a window between the two calls
       where a crash (or a lost EXPIRE) leaves an immortal
       counter, and under the fixed-window rate-limit contract a
       lost window is a correctness bug. The script does both in
       one atomic step and only sets the expiry on the first
       increment (n == 1), which is exactly the "first write sets
       the window, later writes do not reset it" semantics of the
       port.

     - mergeSketch does NOT use Redis's native PFADD/PFMERGE.
       Those operate on Redis's OWN HyperLogLog byte format, which
       is not the @snapurl/domain layout the rest of the product
       stores. To keep sketch bytes portable across all three
       adapters we read our bytes (getBuffer), merge them in JS
       with domain.merge, and write them back. Under concurrency
       two mergeSketch calls can interleave, but because the merge
       is a register-wise max (idempotent and commutative) a lost
       update only ever drops a max that a later merge re-applies;
       the hardening path, if a live workload ever needs it, is to
       wrap the read-merge-write in a WATCH/MULTI optimistic loop
       or a Lua script fed the merged bytes.
   ============================================================ */

/**
 * Atomic fixed-window increment: INCR, and on the first increment
 * (n == 1) set the expiry from ARGV[1]. An empty ARGV[1] means "no
 * ttl", so a plain counter with no window is still supported.
 */
const INCR_WITH_EXPIRY = `
local n = redis.call('INCR', KEYS[1])
if n == 1 and ARGV[1] ~= '' then
  redis.call('EXPIRE', KEYS[1], ARGV[1])
end
return n
`;

export class RedisCacheStore implements CacheStore {
  constructor(private readonly client: Redis) {}

  async get(key: string): Promise<string | null> {
    return this.client.get(key);
  }

  async set(key: string, value: string, ttlSeconds?: number): Promise<void> {
    if (ttlSeconds === undefined) {
      await this.client.set(key, value);
    } else {
      await this.client.set(key, value, "EX", ttlSeconds);
    }
  }

  async incr(key: string, ttlSeconds?: number): Promise<number> {
    const result = await this.client.eval(
      INCR_WITH_EXPIRY,
      1,
      key,
      ttlSeconds === undefined ? "" : String(ttlSeconds),
    );
    return Number(result);
  }

  async expire(key: string, ttlSeconds: number): Promise<void> {
    await this.client.expire(key, ttlSeconds);
  }

  async del(key: string): Promise<void> {
    await this.client.del(key);
  }

  async pttl(key: string): Promise<number> {
    // Redis PTTL is the source these semantics were modelled on: it
    // returns the remaining ttl in milliseconds, -2 when the key is
    // absent and -1 when it exists with no expiry.
    return this.client.pttl(key);
  }

  async mergeSketch(
    key: string,
    sketch: Uint8Array,
    ttlSeconds?: number,
  ): Promise<{ estimate: number }> {
    // Read our sketch bytes as a raw Buffer (not decoded as utf-8).
    const existing = await this.client.getBuffer(key);
    const current = existing ? deserialize(existing) : createSketch();
    const merged = merge(current, sketch);
    const bytes = serialize(merged);
    if (ttlSeconds === undefined) {
      await this.client.set(key, bytes);
    } else {
      await this.client.set(key, bytes, "EX", ttlSeconds);
    }
    return { estimate: estimate(merged) };
  }
}
