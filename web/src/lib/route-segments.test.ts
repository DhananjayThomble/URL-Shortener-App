import { describe, expect, it } from "vitest";
import { bioPublicPath, decodeSegment, decodeSegments } from "./route-segments";

/* #849 — Next 15.5 hands dynamic route segments back still percent-encoded
   ("localhost%3A3002"). Every consumer re-encodes before building an API path,
   so an undecoded segment is encoded twice ("localhost%253A3002") and the API
   answers 404. These pin: decode each segment exactly once, and a malformed
   escape is "no such page", never a thrown 500. */

describe("decodeSegment", () => {
  it("decodes a percent-encoded port separator", () => {
    expect(decodeSegment("localhost%3A3002")).toBe("localhost:3002");
  });

  it("leaves a segment with nothing encoded unchanged", () => {
    expect(decodeSegment("snap.to")).toBe("snap.to");
    expect(decodeSegment("my-page_1.x")).toBe("my-page_1.x");
  });

  it("decodes once, not repeatedly: an encoded percent stays a literal %", () => {
    expect(decodeSegment("a%253Ab")).toBe("a%3Ab");
  });

  it("decodes multi-byte UTF-8 sequences", () => {
    expect(decodeSegment("caf%C3%A9")).toBe("café");
    expect(decodeSegment("%F0%9F%94%97")).toBe("🔗");
  });

  it("returns null for a malformed escape instead of throwing", () => {
    expect(decodeSegment("%")).toBeNull();
    expect(decodeSegment("100%")).toBeNull();
    expect(decodeSegment("%zz")).toBeNull();
    expect(decodeSegment("%E0%A4%A")).toBeNull(); // truncated multi-byte sequence
    expect(decodeSegment("%C0%80")).toBeNull(); // overlong encoding is invalid UTF-8
  });
});

describe("decodeSegments", () => {
  it("decodes every segment", () => {
    expect(decodeSegments(["localhost%3A3002", "my-page"])).toEqual(["localhost:3002", "my-page"]);
  });

  it("treats a missing list (the bare /b route) as no segments", () => {
    expect(decodeSegments(undefined)).toEqual([]);
    expect(decodeSegments([])).toEqual([]);
  });

  it("returns null when ANY segment is malformed", () => {
    expect(decodeSegments(["localhost%3A3002", "bad%"])).toBeNull();
    expect(decodeSegments(["bad%", "slug"])).toBeNull();
  });
});

describe("bioPublicPath", () => {
  it("encodes a decoded domain exactly once for the API probe", () => {
    expect(bioPublicPath(["localhost:3002", "my-page"])).toBe(
      "/public/bio-pages/by-domain/localhost%3A3002/my-page",
    );
  });

  it("builds the slug-only alias path for a single segment", () => {
    expect(bioPublicPath(["my-page"])).toBe("/public/bio-pages/my-page");
  });

  it("is not an address with no segments or more than two", () => {
    expect(bioPublicPath([])).toBeNull();
    expect(bioPublicPath(["a", "b", "c"])).toBeNull();
  });

  it("end to end: the raw URL segments from Next yield the single-encoded API path", () => {
    const segments = decodeSegments(["localhost%3A3002", "my-page"]);
    expect(segments).not.toBeNull();
    expect(bioPublicPath(segments!)).toBe("/public/bio-pages/by-domain/localhost%3A3002/my-page");
  });

  it("end to end: a domain with no encoded character is unaffected", () => {
    const segments = decodeSegments(["snap.to", "my-page"]);
    expect(bioPublicPath(segments!)).toBe("/public/bio-pages/by-domain/snap.to/my-page");
  });
});
