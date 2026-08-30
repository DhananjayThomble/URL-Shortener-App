import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Redis } from "ioredis";
import {
  addHashed,
  createSketch,
  estimate,
  hashForTesting,
  merge,
  serialize,
} from "@snapurl/domain";
import { RedisCacheStore } from "./redis-cache-store.js";

/* MOCK-based unit tests: no live Redis is available in-sandbox or in
   CI, so a fake ioredis client asserts the RIGHT commands are issued.
   A live-Redis integration test is deferred to the deploy phase. */

interface FakeRedis {
  get: ReturnType<typeof vi.fn>;
  getBuffer: ReturnType<typeof vi.fn>;
  set: ReturnType<typeof vi.fn>;
  eval: ReturnType<typeof vi.fn>;
  expire: ReturnType<typeof vi.fn>;
  del: ReturnType<typeof vi.fn>;
  pttl: ReturnType<typeof vi.fn>;
}

function fakeClient(): FakeRedis {
  return {
    get: vi.fn(),
    getBuffer: vi.fn(),
    set: vi.fn().mockResolvedValue("OK"),
    eval: vi.fn(),
    expire: vi.fn().mockResolvedValue(1),
    del: vi.fn().mockResolvedValue(1),
    pttl: vi.fn().mockResolvedValue(-2),
  };
}

describe("RedisCacheStore", () => {
  let client: FakeRedis;
  let store: RedisCacheStore;

  beforeEach(() => {
    client = fakeClient();
    store = new RedisCacheStore(client as unknown as Redis);
  });

  it("get delegates to client.get", async () => {
    client.get.mockResolvedValue("v");
    expect(await store.get("k")).toBe("v");
    expect(client.get).toHaveBeenCalledWith("k");
  });

  it("set without ttl issues a plain SET", async () => {
    await store.set("k", "v");
    expect(client.set).toHaveBeenCalledWith("k", "v");
  });

  it("set with ttl issues SET ... EX", async () => {
    await store.set("k", "v", 90);
    expect(client.set).toHaveBeenCalledWith("k", "v", "EX", 90);
  });

  it("incr issues the Lua eval with the ttl and returns the new count", async () => {
    client.eval.mockResolvedValue(1);
    const n = await store.incr("c", 60);
    expect(n).toBe(1);

    // Script text carries INCR + conditional EXPIRE; KEYS[1] is the key,
    // ARGV[1] is the ttl. numkeys is 1.
    const [script, numkeys, key, ttl] = client.eval.mock.calls[0]!;
    expect(String(script)).toContain("INCR");
    expect(String(script)).toContain("EXPIRE");
    expect(numkeys).toBe(1);
    expect(key).toBe("c");
    expect(ttl).toBe("60");
  });

  it("incr without ttl passes an empty ARGV so no expiry is set", async () => {
    client.eval.mockResolvedValue(5);
    const n = await store.incr("c");
    expect(n).toBe(5);
    const args = client.eval.mock.calls[0]!;
    expect(args[3]).toBe("");
  });

  it("the atomic script sets expiry only on the first increment (n == 1)", () => {
    // The correctness of "first write sets the window, later writes do not
    // reset it" lives in the Lua script itself: EXPIRE runs only when n == 1.
    // Assert the script encodes that guard rather than requiring a live eval.
    client.eval.mockResolvedValue(2);
    return store.incr("c", 60).then(() => {
      const script = String(client.eval.mock.calls[0]![0]);
      expect(script).toContain("n == 1");
      expect(script).toMatch(/if\s+n\s*==\s*1/);
    });
  });

  it("expire delegates to client.expire", async () => {
    await store.expire("k", 45);
    expect(client.expire).toHaveBeenCalledWith("k", 45);
  });

  it("del delegates to client.del", async () => {
    await store.del("k");
    expect(client.del).toHaveBeenCalledWith("k");
  });

  it("pttl delegates to client.pttl and returns the remaining millis", async () => {
    client.pttl.mockResolvedValue(1234);
    expect(await store.pttl("k")).toBe(1234);
    expect(client.pttl).toHaveBeenCalledWith("k");
  });

  it("mergeSketch reads via getBuffer, writes merged bytes, returns the estimate", async () => {
    const a = createSketch();
    const b = createSketch();
    for (let i = 0; i < 400; i++) addHashed(a, hashForTesting(`a-${i}`));
    for (let i = 0; i < 400; i++) addHashed(b, hashForTesting(`b-${i}`));

    // Stored state is sketch `a`; the caller merges `b` on top.
    client.getBuffer.mockResolvedValue(serialize(a));

    const result = await store.mergeSketch("s", b, 120);

    expect(client.getBuffer).toHaveBeenCalledWith("s");
    // Wrote merged bytes with an EX ttl (not Redis PFMERGE).
    const [key, bytes, ex, ttl] = client.set.mock.calls[0]!;
    expect(key).toBe("s");
    expect(Buffer.isBuffer(bytes) || bytes instanceof Uint8Array).toBe(true);
    expect(ex).toBe("EX");
    expect(ttl).toBe(120);
    // The persisted bytes equal the domain merge, and so does the estimate.
    expect(Buffer.from(bytes)).toEqual(serialize(merge(a, b)));
    expect(result.estimate).toBe(estimate(merge(a, b)));
  });

  it("mergeSketch starts from an empty sketch when the key is absent", async () => {
    const b = createSketch();
    for (let i = 0; i < 100; i++) addHashed(b, hashForTesting(`b-${i}`));
    client.getBuffer.mockResolvedValue(null);

    const result = await store.mergeSketch("s", b);
    expect(result.estimate).toBe(estimate(b));
    // No ttl given => plain SET.
    expect(client.set.mock.calls[0]!.length).toBe(2);
  });
});
