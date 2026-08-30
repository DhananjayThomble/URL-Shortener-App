import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  addHashed,
  createSketch,
  estimate,
  hashForTesting,
  merge,
} from "@snapurl/domain";
import { MemoryCacheStore } from "./memory-cache-store.js";

/* Pure unit tests for the default adapter: no network, no DB gate.
   Time is controlled with vi.setSystemTime so ttl expiry is
   deterministic. */

describe("MemoryCacheStore", () => {
  let store: MemoryCacheStore;

  beforeEach(() => {
    store = new MemoryCacheStore();
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2025-01-01T00:00:00.000Z"));
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("round-trips a value with get/set", async () => {
    expect(await store.get("k")).toBeNull();
    await store.set("k", "hello");
    expect(await store.get("k")).toBe("hello");
  });

  it("expires a value after its ttl (lazy, on read)", async () => {
    await store.set("k", "v", 60);
    expect(await store.get("k")).toBe("v");

    vi.setSystemTime(new Date("2025-01-01T00:00:59.000Z"));
    expect(await store.get("k")).toBe("v");

    vi.setSystemTime(new Date("2025-01-01T00:01:00.000Z"));
    expect(await store.get("k")).toBeNull();
  });

  it("increments and returns the new count", async () => {
    expect(await store.incr("c")).toBe(1);
    expect(await store.incr("c")).toBe(2);
    expect(await store.incr("c")).toBe(3);
  });

  it("sets the window on the first incr and does NOT reset it later", async () => {
    // First incr in the window stamps a 60s expiry.
    expect(await store.incr("w", 60)).toBe(1);

    // A later incr just before the window closes must NOT push it out.
    vi.setSystemTime(new Date("2025-01-01T00:00:59.000Z"));
    expect(await store.incr("w", 60)).toBe(2);

    // The key still expires at the ORIGINAL time, not 60s after the 2nd incr.
    vi.setSystemTime(new Date("2025-01-01T00:01:00.000Z"));
    expect(await store.get("w")).toBeNull();
    // And the counter has been evicted, so the next incr starts fresh at 1.
    expect(await store.incr("w", 60)).toBe(1);
  });

  it("updates ttl via expire", async () => {
    await store.set("k", "v");
    await store.expire("k", 30);
    expect(await store.get("k")).toBe("v");

    vi.setSystemTime(new Date("2025-01-01T00:00:30.000Z"));
    expect(await store.get("k")).toBeNull();
  });

  it("removes a key via del", async () => {
    await store.set("k", "v");
    await store.del("k");
    expect(await store.get("k")).toBeNull();
  });

  it("mergeSketch equals the domain merge/estimate", async () => {
    // Two independent domain sketches.
    const a = createSketch();
    const b = createSketch();
    for (let i = 0; i < 500; i++) addHashed(a, hashForTesting(`a-${i}`));
    for (let i = 0; i < 500; i++) addHashed(b, hashForTesting(`b-${i}`));

    await store.mergeSketch("s", a);
    const result = await store.mergeSketch("s", b);

    // The store's accumulated estimate equals estimate(merge(a, b)).
    const expected = estimate(merge(a, b));
    expect(result.estimate).toBe(expected);
  });

  it("mergeSketch is idempotent for a repeated sketch", async () => {
    const a = createSketch();
    for (let i = 0; i < 300; i++) addHashed(a, hashForTesting(`x-${i}`));

    const first = await store.mergeSketch("s", a);
    const second = await store.mergeSketch("s", a);
    expect(second.estimate).toBe(first.estimate);
    expect(second.estimate).toBe(estimate(a));
  });
});
