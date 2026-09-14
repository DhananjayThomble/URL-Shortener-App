import { describe, expect, it } from "vitest";
import { slugFromShortUrl } from "./csv";
import { bitly } from "./sources/bitly";

describe("slugFromShortUrl", () => {
  it("takes the last path segment of a full short URL", () => {
    expect(slugFromShortUrl("https://bit.ly/3abcXyz")).toBe("3abcXyz");
    expect(slugFromShortUrl("bit.ly/promo")).toBe("promo");
    expect(slugFromShortUrl("https://on.bra.nd/spring-sale")).toBe("spring-sale");
  });

  it("strips query, fragment and trailing slashes", () => {
    expect(slugFromShortUrl("bit.ly/promo/?x=1")).toBe("promo");
    expect(slugFromShortUrl("bit.ly/promo#top")).toBe("promo");
  });

  it("returns '' for a bare domain or empty cell so the server generates one", () => {
    expect(slugFromShortUrl("bit.ly")).toBe("");
    expect(slugFromShortUrl("https://bit.ly/")).toBe("");
    expect(slugFromShortUrl("")).toBe("");
  });
});

describe("bitly source", () => {
  it("maps Long URL, derives the back-half from the Bitlink, and carries title/tags", () => {
    const csv =
      "Bitlink,Title,Long URL,Tags\n" +
      "https://bit.ly/3abcXyz,Spring Sale,https://acme.com/spring,\"promo, seasonal\"";
    const r = bitly.parse(csv);
    expect(r.errors).toEqual([]);
    expect(r.rows).toEqual([
      {
        destination: "https://acme.com/spring",
        slug: "3abcXyz",
        title: "Spring Sale",
        tags: ["promo", "seasonal"],
        sourceIndex: 0,
      },
    ]);
  });

  it("errors a row with no Long URL", () => {
    const r = bitly.parse("Bitlink,Title\nbit.ly/x,Just a title");
    expect(r.rows).toEqual([]);
    expect(r.errors[0]!.message).toContain("Long URL");
  });

  it("flags Bitly-specific dropped fields only when present", () => {
    const withMeta = bitly.parse(
      "Bitlink,Long URL,Created,Total Clicks,Campaign\nbit.ly/x,https://a.com,2020-01-01,42,Q1 Launch",
    );
    expect(withMeta.dropped.map((d) => d.field)).toEqual(["Created date", "Total clicks", "Campaign / group"]);

    const lean = bitly.parse("Bitlink,Long URL\nbit.ly/x,https://a.com");
    expect(lean.dropped).toEqual([]);
  });
});
