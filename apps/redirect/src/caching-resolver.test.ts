import { beforeEach, describe, expect, it, vi } from "vitest";
import { MemoryCacheStore } from "@snapurl/cache";
import { CachingLinkResolver } from "./caching-resolver.js";
import type { LinkResolver, ResolvedDomain, ResolvedLink } from "./resolver.js";

/* Pure unit tests: no DB gate, no network. A real MemoryCacheStore backs the
   cache and a spy LinkResolver stands in for the Postgres resolver, so we can
   assert that a hot link is served without touching the inner resolver. */

const TTL = 10;

/** A fully-populated ResolvedLink whose Date fields exercise the revive path:
 *  expiresAt is a real Date, activatesAt is null. */
function makeLink(overrides: Partial<ResolvedLink> = {}): ResolvedLink {
  return {
    id: "link-1",
    workspaceId: "ws-1",
    destination: "https://example.com/dest",
    redirectType: "302",
    rules: [],
    expiresAt: new Date("2030-01-01T00:00:00.000Z"),
    expiresTo: null,
    activatesAt: null,
    scheduledTo: null,
    clickLimit: null,
    clicks: 0,
    hasPassword: false,
    forwardQuery: false,
    deepLink: false,
    hideReferrer: false,
    publicPreview: false,
    archived: false,
    safeBrowsingStatus: "clean",
    utm: null,
    ...overrides,
  };
}

/** A spy inner resolver whose resolve() returns a fixed link per (host, slug). */
function spyInner(link: ResolvedLink | null): {
  resolver: LinkResolver;
  resolve: ReturnType<typeof vi.fn>;
  resolveDomain: ReturnType<typeof vi.fn>;
} {
  const resolve = vi.fn(async () => link);
  const resolveDomain = vi.fn(async (): Promise<ResolvedDomain | null> => null);
  return { resolver: { resolve, resolveDomain }, resolve, resolveDomain };
}

describe("CachingLinkResolver", () => {
  let cache: MemoryCacheStore;

  beforeEach(() => {
    cache = new MemoryCacheStore();
  });

  it("calls the inner resolver on a miss and populates the cache", async () => {
    const link = makeLink();
    const { resolver, resolve } = spyInner(link);
    const caching = new CachingLinkResolver(resolver, cache, TTL);

    const result = await caching.resolve("snap.to", "hot");
    expect(result).toEqual(link);
    expect(resolve).toHaveBeenCalledTimes(1);
    // The entry is now cached under the normalised key.
    expect(await cache.get("link:snap.to:hot")).not.toBeNull();
  });

  it("serves a second resolve of the same link from the cache without touching the inner resolver", async () => {
    const link = makeLink();
    const { resolver, resolve } = spyInner(link);
    const caching = new CachingLinkResolver(resolver, cache, TTL);

    await caching.resolve("snap.to", "hot");
    const second = await caching.resolve("snap.to", "hot");

    // The DB (inner resolver) was NOT touched the second time.
    expect(resolve).toHaveBeenCalledTimes(1);
    expect(second).toEqual(link);
  });

  it("round-trips the ResolvedLink shape identically through the cache, including Date fields", async () => {
    const link = makeLink();
    const { resolver } = spyInner(link);
    const caching = new CachingLinkResolver(resolver, cache, TTL);

    await caching.resolve("snap.to", "hot");
    const revived = await caching.resolve("snap.to", "hot");

    expect(revived).not.toBeNull();
    // Date fields come back as real Date instances, not ISO strings.
    expect(revived!.expiresAt).toBeInstanceOf(Date);
    expect(revived!.expiresAt!.toISOString()).toBe("2030-01-01T00:00:00.000Z");
    // null is preserved exactly, not turned into a string or a Date.
    expect(revived!.activatesAt).toBeNull();
    // The whole shape is byte-identical to the original.
    expect(revived).toEqual(link);
  });

  it("keys case-insensitively so a hit matches the DB normalisation", async () => {
    const link = makeLink();
    const { resolver, resolve } = spyInner(link);
    const caching = new CachingLinkResolver(resolver, cache, TTL);

    await caching.resolve("SNAP.TO", "HOT");
    // Different casing on host + slug resolves to the same cache entry.
    const second = await caching.resolve("snap.to", "hot");
    expect(resolve).toHaveBeenCalledTimes(1);
    expect(second).toEqual(link);
  });

  it("falls through to the inner resolver on a miss for a different slug", async () => {
    const link = makeLink();
    const { resolver, resolve } = spyInner(link);
    const caching = new CachingLinkResolver(resolver, cache, TTL);

    await caching.resolve("snap.to", "hot");
    await caching.resolve("snap.to", "other");
    // Each distinct slug is its own miss, so the inner resolver is called twice.
    expect(resolve).toHaveBeenCalledTimes(2);
  });

  it("does not cache a miss (null) — a later create is not shadowed by a negative entry", async () => {
    const { resolver, resolve } = spyInner(null);
    const caching = new CachingLinkResolver(resolver, cache, TTL);

    expect(await caching.resolve("snap.to", "ghost")).toBeNull();
    expect(await caching.resolve("snap.to", "ghost")).toBeNull();
    // Both calls fell through: nulls are never cached.
    expect(resolve).toHaveBeenCalledTimes(2);
    expect(await cache.get("link:snap.to:ghost")).toBeNull();
  });

  it("passes resolveDomain straight through to the inner resolver", async () => {
    const { resolver, resolveDomain } = spyInner(null);
    const domain: ResolvedDomain = {
      id: "dom-1",
      rootRedirect: "https://example.com/root",
      notFoundRedirect: null,
    };
    resolveDomain.mockResolvedValue(domain);
    const caching = new CachingLinkResolver(resolver, cache, TTL);

    const result = await caching.resolveDomain("snap.to");
    expect(result).toEqual(domain);
    expect(resolveDomain).toHaveBeenCalledWith("snap.to");
  });
});
