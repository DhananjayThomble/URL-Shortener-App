import { describe, expect, it } from "vitest";
import type { UpsertBioPageInput } from "@snapurl/contract";
import { bioInputErrors, safeHttpHref } from "./bio-page";

/* #788 — the two pure decisions behind the bio editor and the public page:
   which block URLs may become a real <a href>, and which field of which block
   each validation complaint belongs to. Web tests are Node-only, so the UI
   reads these instead of deciding inline. */

function input(blocks: Partial<UpsertBioPageInput["blocks"][number]>[], profile = { name: "Ada", bio: "" }): unknown {
  return {
    domain: "snap.to",
    slug: "ada",
    status: "draft",
    profile,
    blocks: blocks.map((b) => ({ kind: "link", title: "A link", subtitle: null, locked: false, href: "https://example.com/", ...b })),
  };
}

describe("safeHttpHref", () => {
  it("passes http(s) URLs through untouched", () => {
    expect(safeHttpHref("https://example.com/a?b=1#c")).toBe("https://example.com/a?b=1#c");
    expect(safeHttpHref("http://example.com")).toBe("http://example.com");
  });

  it("refuses every non-http(s) scheme", () => {
    for (const bad of [
      "javascript:alert(1)",
      "JaVaScRiPt:alert(1)",
      "java\tscript:alert(1)",
      " javascript:alert(1)",
      "data:text/html,<script>alert(1)</script>",
      "vbscript:msgbox(1)",
      "file:///etc/passwd",
      "mailto:a@b.co",
      "//example.com",
    ]) {
      expect(safeHttpHref(bad), bad).toBeNull();
    }
  });

  it("refuses a scheme-less or unparseable value, and empties", () => {
    expect(safeHttpHref("example.com")).toBeNull();
    expect(safeHttpHref("not a url")).toBeNull();
    expect(safeHttpHref("")).toBeNull();
    expect(safeHttpHref("   ")).toBeNull();
    expect(safeHttpHref(null)).toBeNull();
    expect(safeHttpHref(undefined)).toBeNull();
  });
});

describe("bioInputErrors", () => {
  it("reports nothing for a valid page", () => {
    const e = bioInputErrors(input([{}, { href: null }]));
    expect(e.count).toBe(0);
    expect(e.blocks).toEqual({});
    expect(e.profile).toEqual({});
    expect(e.other).toBeNull();
  });

  it("attributes a bad URL to the block that has it, by index", () => {
    const e = bioInputErrors(input([{}, { href: "not a url" }, {}]));
    expect(e.blocks[1]?.href).toBe("Enter an absolute http(s) URL");
    expect(e.blocks[0]).toBeUndefined();
    expect(e.blocks[2]).toBeUndefined();
    expect(e.count).toBe(1);
  });

  it("flags a scheme-less URL and non-http schemes", () => {
    for (const href of ["example.com", "javascript:alert(1)", "data:text/html;base64,AAAA", "ftp://example.com/x"]) {
      expect(bioInputErrors(input([{ href }])).blocks[0]?.href, href).toBe("Enter an absolute http(s) URL");
    }
  });

  it("reports every bad block, not just the first", () => {
    const e = bioInputErrors(input([{ href: "nope" }, {}, { href: "also nope" }]));
    expect(Object.keys(e.blocks)).toEqual(["0", "2"]);
    expect(e.count).toBe(2);
  });

  it("reports title and URL problems of the same block together", () => {
    const e = bioInputErrors(input([{ title: "   ", href: "nope" }]));
    expect(e.blocks[0]?.title).toBeTruthy();
    expect(e.blocks[0]?.href).toBe("Enter an absolute http(s) URL");
    expect(e.count).toBe(2);
  });

  it("flags an over-long title", () => {
    expect(bioInputErrors(input([{ title: "x".repeat(161) }])).blocks[0]?.title).toBeTruthy();
    expect(bioInputErrors(input([{ title: "x".repeat(160) }])).count).toBe(0);
  });

  it("flags the URLs the SSRF guard refuses", () => {
    expect(bioInputErrors(input([{ href: "http://127.0.0.1/admin" }])).blocks[0]?.href).toMatch(/isn't allowed/);
    expect(bioInputErrors(input([{ href: "https://user:pw@example.com/" }])).blocks[0]?.href).toMatch(/username or password/);
  });

  it("attributes profile problems to the profile fields", () => {
    const e = bioInputErrors(input([], { name: "", bio: "x".repeat(281) }));
    expect(e.profile.name).toBeTruthy();
    expect(e.profile.bio).toBeTruthy();
    expect(e.blocks).toEqual({});
  });

  it("keeps a page-level problem (too many blocks) out of any single block", () => {
    const e = bioInputErrors(input(Array.from({ length: 51 }, () => ({}))));
    expect(e.blocks).toEqual({});
    expect(e.other).toBeTruthy();
    expect(e.count).toBe(1);
  });
});
