import { describe, expect, it, vi } from "vitest";
import { MemoryCacheStore } from "@snapurl/cache";
import { listenForCacheBust } from "./cache-bust-listener.js";

/* Pure unit tests: no Postgres. The `client` here is a hand-rolled stub that
   captures the listener callback listen() was given, so these tests drive
   the notify handling directly without a real LISTEN/NOTIFY round trip
   (apps/redirect/src/link-cache-bust.integration.test.ts covers that, against
   a real Postgres). */

function fakeClient() {
  let handler: ((payload: string) => void) | undefined;
  return {
    listen: vi.fn(async (_channel: string, cb: (payload: string) => void) => {
      handler = cb;
    }),
    fire(payload: string) {
      handler!(payload);
    },
  };
}

describe("listenForCacheBust", () => {
  it("registers a LISTEN on the link_cache_bust channel", async () => {
    const client = fakeClient();
    const cache = new MemoryCacheStore();
    await listenForCacheBust(client as never, cache);
    expect(client.listen).toHaveBeenCalledWith("link_cache_bust", expect.any(Function));
  });

  it("evicts the matching linkCacheKey on a well-formed notification", async () => {
    const client = fakeClient();
    const cache = new MemoryCacheStore();
    await cache.set("link:snap.to|hot", JSON.stringify({ destination: "https://example.com" }));

    await listenForCacheBust(client as never, cache);
    client.fire(JSON.stringify({ host: "SNAP.TO", slug: "HOT" }));
    // Async del() inside the handler; await a microtask so it lands.
    await Promise.resolve();
    await Promise.resolve();

    expect(await cache.get("link:snap.to|hot")).toBeNull();
  });

  it("leaves an unrelated key untouched", async () => {
    const client = fakeClient();
    const cache = new MemoryCacheStore();
    await cache.set("link:snap.to|other", "unrelated");

    await listenForCacheBust(client as never, cache);
    client.fire(JSON.stringify({ host: "snap.to", slug: "hot" }));
    await Promise.resolve();
    await Promise.resolve();

    expect(await cache.get("link:snap.to|other")).toBe("unrelated");
  });

  it("swallows an unparseable payload and logs a warning", async () => {
    const client = fakeClient();
    const cache = new MemoryCacheStore();
    const log = { warn: vi.fn() };

    await listenForCacheBust(client as never, cache, log);
    expect(() => client.fire("not json")).not.toThrow();

    expect(log.warn).toHaveBeenCalledWith(
      expect.objectContaining({ payload: "not json" }),
      expect.stringContaining("unparseable"),
    );
  });

  it("ignores a payload missing host or slug", async () => {
    const client = fakeClient();
    const cache = new MemoryCacheStore();
    const delSpy = vi.spyOn(cache, "del");

    await listenForCacheBust(client as never, cache);
    client.fire(JSON.stringify({ host: "snap.to" }));
    await Promise.resolve();

    expect(delSpy).not.toHaveBeenCalled();
  });

  it("logs rather than throws when the eviction itself fails", async () => {
    const client = fakeClient();
    const cache = new MemoryCacheStore();
    vi.spyOn(cache, "del").mockRejectedValueOnce(new Error("store unavailable"));
    const log = { warn: vi.fn() };

    await listenForCacheBust(client as never, cache, log);
    expect(() => client.fire(JSON.stringify({ host: "snap.to", slug: "hot" }))).not.toThrow();
    await Promise.resolve();
    await Promise.resolve();

    expect(log.warn).toHaveBeenCalledWith(
      expect.objectContaining({ host: "snap.to", slug: "hot" }),
      expect.stringContaining("eviction failed"),
    );
  });
});
