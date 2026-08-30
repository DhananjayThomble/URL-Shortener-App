import {
  createSketch,
  deserialize,
  estimate,
  merge,
  serialize,
} from "@snapurl/domain";
import type { CacheStore } from "./cache-store.js";

/* ============================================================
   MemoryCacheStore — the default adapter.

   Backed by a single Map in one Node process. This is what CI,
   docker compose and local development use, and it is the
   single-node profile of the product: no external dependency,
   nothing to warm, nothing to run alongside the app.

   Two things are worth stating plainly:

     - Expiry is lazy. There is no background sweeper; a key is
       evicted the first time it is read (get/incr/mergeSketch)
       after its expiresAt has passed. That keeps writes cheap and
       is correct for every read path the port exposes.

     - incr is atomic here for free. A single Node process runs
       one increment to completion before the next microtask, so
       the read-modify-write below cannot interleave. That is the
       whole reason the in-memory profile is single-node: two
       processes each with their own Map would each count to the
       limit, which is exactly the bug the Redis/DynamoDB adapters
       exist to fix for the scaled and serverless profiles.
   ============================================================ */

interface Entry {
  /** String values for get/set/incr; Uint8Array for sketch keys. */
  value: string | Uint8Array;
  /** Epoch millis at which this key expires, or null for no expiry. */
  expiresAt: number | null;
}

export class MemoryCacheStore implements CacheStore {
  private readonly store = new Map<string, Entry>();

  /**
   * Evict the key if it has an expiry that has passed, then return the
   * live entry (or undefined). Every read path calls this first so
   * lazy expiry is observed consistently.
   */
  private live(key: string): Entry | undefined {
    const entry = this.store.get(key);
    if (!entry) return undefined;
    if (entry.expiresAt !== null && Date.now() >= entry.expiresAt) {
      this.store.delete(key);
      return undefined;
    }
    return entry;
  }

  private expiryFrom(ttlSeconds?: number): number | null {
    return ttlSeconds === undefined ? null : Date.now() + ttlSeconds * 1000;
  }

  async get(key: string): Promise<string | null> {
    const entry = this.live(key);
    if (!entry) return null;
    return typeof entry.value === "string" ? entry.value : null;
  }

  async set(key: string, value: string, ttlSeconds?: number): Promise<void> {
    this.store.set(key, { value, expiresAt: this.expiryFrom(ttlSeconds) });
  }

  async incr(key: string, ttlSeconds?: number): Promise<number> {
    const entry = this.live(key);
    if (!entry) {
      // First write in this window: create at 1 and stamp the expiry.
      this.store.set(key, {
        value: "1",
        expiresAt: this.expiryFrom(ttlSeconds),
      });
      return 1;
    }
    // Subsequent increment within the window: bump the count but leave
    // expiresAt untouched, so the fixed window still closes on schedule.
    const current = typeof entry.value === "string" ? parseInt(entry.value, 10) : 0;
    const next = (Number.isNaN(current) ? 0 : current) + 1;
    entry.value = String(next);
    return next;
  }

  async expire(key: string, ttlSeconds: number): Promise<void> {
    const entry = this.live(key);
    if (entry) entry.expiresAt = Date.now() + ttlSeconds * 1000;
  }

  async del(key: string): Promise<void> {
    this.store.delete(key);
  }

  async mergeSketch(
    key: string,
    sketch: Uint8Array,
    ttlSeconds?: number,
  ): Promise<{ estimate: number }> {
    const entry = this.live(key);
    const current =
      entry && entry.value instanceof Uint8Array
        ? deserialize(entry.value)
        : createSketch();
    const merged = merge(current, sketch);
    if (!entry) {
      // First write: persist the merged bytes and stamp the expiry.
      this.store.set(key, {
        value: serialize(merged),
        expiresAt: this.expiryFrom(ttlSeconds),
      });
    } else {
      // Subsequent merge: persist bytes, keep the original expiry.
      entry.value = serialize(merged);
    }
    return { estimate: estimate(merged) };
  }
}
