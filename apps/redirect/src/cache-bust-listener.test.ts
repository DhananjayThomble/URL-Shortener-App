import { describe, expect, it, vi } from "vitest";
import { MemoryCacheStore, linkCacheKey } from "@snapurl/cache";
import { listenForCacheBust } from "./cache-bust-listener.js";
import type { PgSql } from "@snapurl/database";

/* Pure unit tests: no DB gate, no network. A fake client stands in for the
   postgres.js Sql instance so listenForCacheBust's own logic — payload
   parsing, key computation, error swallowing — has non-DB-gated coverage.
   The real cross-process property (an actual pg_notify reaching this
   function over a real connection) is covered separately by
   link-cache-bust.integration.test.ts, which is DB-gated. */

/** A fake `Sql.listen` that immediately invokes the given notify handler with
 *  each queued payload, synchronously enough for the test to await it. */
function fakeSql(): { sql: Pick<PgSql, "listen">; fire: (payload: string) => Promise<void> } {
  let handler: ((payload: string) => void) | undefined;
  const sql = {
    listen: vi.fn(async (_channel: string, onnotify: (payload: string) => void) => {
      handler = onnotify;
      return { state: {} } as never;
    }),
  };
  return {
    sql,
    fire: async (payload: string) => {
      handler?.(payload);
      // Let any promise the handler kicked off (cache.del()) settle.
      await new Promise((r) => setTimeout(r, 0));
    },
  };
}

describe("listenForCacheBust", () => {
  it("registers a listener on the link_cache_bust channel", async () => {
    const { sql } = fakeSql();
    const cache = new MemoryCacheStore();
    await listenForCacheBust(sql as PgSql, cache);
    expect(sql.listen).toHaveBeenCalledWith("link_cache_bust", expect.any(Function));
  });

  it("evicts the exact linkCacheKey for a well-formed {host, slug} payload", async () => {
    const { sql, fire } = fakeSql();
    const cache = new MemoryCacheStore();
    const key = linkCacheKey("snap.to", "doomed");
    await cache.set(key, "cached-value", 10);

    await listenForCacheBust(sql as PgSql, cache);
    await fire(JSON.stringify({ host: "snap.to", slug: "doomed" }));

    expect(await cache.get(key)).toBeNull();
  });

  it("ignores a payload missing host or slug", async () => {
    const { sql, fire } = fakeSql();
    const cache = new MemoryCacheStore();
    const key = linkCacheKey("snap.to", "still-alive");
    await cache.set(key, "cached-value", 10);

    await listenForCacheBust(sql as PgSql, cache);
    await fire(JSON.stringify({ linkId: "x" }));

    expect(await cache.get(key)).toBe("cached-value");
  });

  it("logs and swallows a payload that fails to parse as JSON", async () => {
    const { sql, fire } = fakeSql();
    const cache = new MemoryCacheStore();
    const warn = vi.fn();

    await listenForCacheBust(sql as PgSql, cache, { warn });
    await fire("not json");

    expect(warn).toHaveBeenCalledWith(
      expect.objectContaining({ payload: "not json" }),
      expect.stringContaining("unparseable"),
    );
  });

  it("logs and swallows a cache.del() failure without throwing", async () => {
    const { sql, fire } = fakeSql();
    const warn = vi.fn();
    const throwingCache = {
      ...new MemoryCacheStore(),
      del: async () => {
        throw new Error("cache unavailable");
      },
    };

    await listenForCacheBust(sql as PgSql, throwingCache as never, { warn });
    await fire(JSON.stringify({ host: "snap.to", slug: "doomed" }));

    expect(warn).toHaveBeenCalledWith(
      expect.objectContaining({ host: "snap.to", slug: "doomed" }),
      expect.stringContaining("eviction failed"),
    );
  });
});
