import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { MemoryCacheStore } from "@snapurl/cache";
import { CacheStoreThrottlerStorage } from "./cache-throttler-storage.js";

/* Pure unit tests: no DB gate, no network. A real MemoryCacheStore backs the
   storage so the counter semantics are exercised for real, and fake timers
   make the ttl-ms->s window deterministic. */

// @nestjs/throttler passes ttl / blockDuration in MILLISECONDS.
const TTL_MS = 60_000;
const LIMIT = 3;
const BLOCK_MS = 0;
const NAME = "default";

describe("CacheStoreThrottlerStorage", () => {
  let cache: MemoryCacheStore;
  let storage: CacheStoreThrottlerStorage;

  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2025-01-01T00:00:00.000Z"));
    cache = new MemoryCacheStore();
    storage = new CacheStoreThrottlerStorage(cache);
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("returns totalHits 1, 2, 3 across repeated increments of the same key", async () => {
    const first = await storage.increment("ip", TTL_MS, LIMIT, BLOCK_MS, NAME);
    const second = await storage.increment("ip", TTL_MS, LIMIT, BLOCK_MS, NAME);
    const third = await storage.increment("ip", TTL_MS, LIMIT, BLOCK_MS, NAME);

    expect(first.totalHits).toBe(1);
    expect(second.totalHits).toBe(2);
    expect(third.totalHits).toBe(3);
  });

  it("flips isBlocked once totalHits exceeds the limit", async () => {
    for (let i = 0; i < LIMIT; i++) {
      const record = await storage.increment("ip", TTL_MS, LIMIT, BLOCK_MS, NAME);
      // Hits 1..LIMIT are within budget.
      expect(record.isBlocked).toBe(false);
    }
    // The (LIMIT + 1)th hit exceeds the budget.
    const blocked = await storage.increment("ip", TTL_MS, LIMIT, BLOCK_MS, NAME);
    expect(blocked.totalHits).toBe(LIMIT + 1);
    expect(blocked.isBlocked).toBe(true);
  });

  it("reports an accurate timeToExpire (millis) that counts down within the window", async () => {
    const first = await storage.increment("ip", TTL_MS, LIMIT, BLOCK_MS, NAME);
    // First hit stamps the window; the full ttl remains.
    expect(first.timeToExpire).toBe(TTL_MS);

    // Half the window later, roughly half remains — and the window is NOT
    // reset by the second increment (fixed window).
    vi.setSystemTime(new Date("2025-01-01T00:00:30.000Z"));
    const second = await storage.increment("ip", TTL_MS, LIMIT, BLOCK_MS, NAME);
    expect(second.timeToExpire).toBe(30_000);
  });

  it("applies the ttl ms->s conversion so the counter resets after the window", async () => {
    await storage.increment("ip", TTL_MS, LIMIT, BLOCK_MS, NAME);
    await storage.increment("ip", TTL_MS, LIMIT, BLOCK_MS, NAME);

    // Advance past the 60s window: the fixed-window key expires and the next
    // increment starts a fresh window at 1.
    vi.setSystemTime(new Date("2025-01-01T00:01:00.000Z"));
    const afterWindow = await storage.increment("ip", TTL_MS, LIMIT, BLOCK_MS, NAME);
    expect(afterWindow.totalHits).toBe(1);
  });

  it("namespaces by throttler name so distinct throttlers count separately", async () => {
    const a = await storage.increment("ip", TTL_MS, LIMIT, BLOCK_MS, "default");
    const b = await storage.increment("ip", TTL_MS, LIMIT, BLOCK_MS, "argon2");
    // Same tracker key, different named throttlers -> independent counters.
    expect(a.totalHits).toBe(1);
    expect(b.totalHits).toBe(1);
  });

  /* The concrete evidence for the multi-instance fix: two storage instances
     over ONE shared backing store see a COMBINED count. That is exactly the
     Lambda scenario the port fixes — each instance would otherwise keep its
     own Map and the effective limit would be limit x instances. */
  it("shares the counter across instances over one backing store", async () => {
    const shared = new MemoryCacheStore();
    const instanceA = new CacheStoreThrottlerStorage(shared);
    const instanceB = new CacheStoreThrottlerStorage(shared);

    const a1 = await instanceA.increment("ip", TTL_MS, LIMIT, BLOCK_MS, NAME);
    expect(a1.totalHits).toBe(1);

    // The SECOND instance sees the first instance's count, not a fresh 1.
    const b1 = await instanceB.increment("ip", TTL_MS, LIMIT, BLOCK_MS, NAME);
    expect(b1.totalHits).toBe(2);

    const a2 = await instanceA.increment("ip", TTL_MS, LIMIT, BLOCK_MS, NAME);
    expect(a2.totalHits).toBe(3);
  });
});
