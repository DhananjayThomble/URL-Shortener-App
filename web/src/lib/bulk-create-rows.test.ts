import { describe, expect, it } from "vitest";
import { parseRows } from "./bulk-create-rows";

/* Regression test for issue #642: a destination with commas in its query
   string was truncated at the first comma. The oracle for what counts as a
   legal back-half is CreateLinkInput.slug's regex in
   packages/contract/src/link.ts (`^[a-zA-Z0-9._-]*$`) — a comma-tail is only
   a chosen slug if it matches that shape, and only a comma *followed by a
   space* (the separator this panel's own placeholder/help text uses) is
   treated as introducing one, since a URL has no unencoded whitespace. */

describe("parseRows", () => {
  it("takes a destination with no comma whole", () => {
    expect(parseRows("https://acme.com/spring")).toEqual([{ destination: "https://acme.com/spring" }]);
  });

  it("splits a destination and a trailing slug-shaped back-half", () => {
    expect(parseRows("https://acme.com/summer, summer-sale")).toEqual([
      { destination: "https://acme.com/summer", slug: "summer-sale" },
    ]);
  });

  it("does not truncate a destination whose query string contains commas with no following space", () => {
    expect(parseRows("https://example.org/search?tags=a,b,c")).toEqual([
      { destination: "https://example.org/search?tags=a,b,c" },
    ]);
  });

  it("still finds a slug-shaped back-half after a comma-bearing query string", () => {
    expect(parseRows("https://example.org/search?tags=a,b,c, pricing")).toEqual([
      { destination: "https://example.org/search?tags=a,b,c", slug: "pricing" },
    ]);
  });

  it("treats a trailing comma-space with nothing after it as no back-half", () => {
    expect(parseRows("https://acme.com/pricing?ref=a, ")).toEqual([
      { destination: "https://acme.com/pricing?ref=a," },
    ]);
  });

  it("rejects a comma-space tail with characters outside the slug pattern as the whole destination", () => {
    expect(parseRows("https://example.org/search?tags=a,b, c d")).toEqual([
      { destination: "https://example.org/search?tags=a,b, c d" },
    ]);
  });

  it("handles multiple lines independently", () => {
    expect(
      parseRows(
        [
          "https://acme.com/spring",
          "https://acme.com/summer, summer-sale",
          "https://acme.com/pricing?ref=a,b,c",
        ].join("\n"),
      ),
    ).toEqual([
      { destination: "https://acme.com/spring" },
      { destination: "https://acme.com/summer", slug: "summer-sale" },
      { destination: "https://acme.com/pricing?ref=a,b,c" },
    ]);
  });

  it("ignores blank lines and trims whitespace", () => {
    expect(parseRows("\n  https://acme.com/a  \n\n  https://acme.com/b, b-slug \n")).toEqual([
      { destination: "https://acme.com/a" },
      { destination: "https://acme.com/b", slug: "b-slug" },
    ]);
  });
});
