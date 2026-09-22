import { describe, expect, it } from "vitest";
import { linkCacheKey } from "./cache-store.js";

/* linkCacheKey is the one place the hot-link cache key format is defined.
   CachingLinkResolver (apps/redirect) and drainOutbox's delete/flag-row bust
   (apps/worker, #470/#426) both call this function rather than building the
   string themselves, so a normalisation bug here would silently desync what
   the two sides think a link's cache entry is called. */

describe("linkCacheKey", () => {
  it("joins host and slug with the link: prefix", () => {
    expect(linkCacheKey("snap.url", "abc123")).toBe("link:snap.url:abc123");
  });

  it("lowercases the host", () => {
    expect(linkCacheKey("Snap.URL", "abc123")).toBe("link:snap.url:abc123");
  });

  it("lowercases the slug", () => {
    expect(linkCacheKey("snap.url", "AbC123")).toBe("link:snap.url:abc123");
  });

  it("trims whitespace from the host but not the slug", () => {
    // Hosts can arrive with incidental whitespace from header parsing;
    // slugs are validated elsewhere and are never expected to carry any,
    // so trimming there would just mask a caller bug instead of catching it.
    expect(linkCacheKey("  snap.url  ", "abc123")).toBe("link:snap.url:abc123");
  });

  it("produces the same key regardless of case, matching case-insensitive lookup", () => {
    const a = linkCacheKey("Snap.URL", "AbC123");
    const b = linkCacheKey("snap.url", "abc123");
    expect(a).toBe(b);
  });

  it("does not collide two different (host, slug) pairs", () => {
    expect(linkCacheKey("a.test", "x")).not.toBe(linkCacheKey("b.test", "x"));
    expect(linkCacheKey("a.test", "x")).not.toBe(linkCacheKey("a.test", "y"));
  });
});
