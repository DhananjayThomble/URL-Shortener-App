import { describe, expect, it } from "vitest";
import { linkCacheKey } from "./cache-store.js";

/* linkCacheKey is the one place the redirect's hot-link cache key format is
   defined. apps/redirect's CachingLinkResolver computes it on read; the
   API's LinkCacheBustService computes it on delete/flag to bust the same
   entry. These tests pin the format itself: normalisation, case-insensitive
   equality, and non-collision — the exact contract both sides depend on
   agreeing on. */
describe("linkCacheKey", () => {
  it("has the link:<host>|<slug> shape", () => {
    expect(linkCacheKey("snap.to", "hot")).toBe("link:snap.to|hot");
  });

  it("lowercases and trims the host", () => {
    expect(linkCacheKey("SNAP.TO", "hot")).toBe("link:snap.to|hot");
    expect(linkCacheKey("  snap.to  ", "hot")).toBe("link:snap.to|hot");
  });

  it("lowercases the slug", () => {
    expect(linkCacheKey("snap.to", "HoT")).toBe("link:snap.to|hot");
  });

  it("produces the same key regardless of casing/whitespace on either input", () => {
    const a = linkCacheKey("SNAP.TO", "Spring");
    const b = linkCacheKey(" snap.to ", "spring");
    expect(a).toBe(b);
  });

  it("does not collide across different (host, slug) pairs", () => {
    const keys = new Set([
      linkCacheKey("snap.to", "a"),
      linkCacheKey("snap.to", "b"),
      linkCacheKey("other.to", "a"),
      linkCacheKey("other.to", "b"),
    ]);
    expect(keys.size).toBe(4);
  });

  it("does not collide when a Host header carries a non-default port", () => {
    // A Host header can legitimately be "localhost:3002". The "|" separator
    // (not ":") means this can never shift the host/slug boundary and
    // collide with a different pair.
    expect(linkCacheKey("localhost:3002", "c")).not.toBe(linkCacheKey("localhost", "3002|c"));
  });
});
