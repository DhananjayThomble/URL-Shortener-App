import { describe, expect, it } from "vitest";
import { dub } from "./sources/dub";

describe("dub source", () => {
  it("maps Destination URL, Key, Title, Description and Tags", () => {
    const csv =
      "Key,Destination URL,Title,Description,Tags\n" +
      "spring,https://acme.com/spring,Spring Sale,Our big spring push,\"promo, seasonal\"";
    const r = dub.parse(csv);
    expect(r.errors).toEqual([]);
    expect(r.rows).toEqual([
      {
        destination: "https://acme.com/spring",
        slug: "spring",
        title: "Spring Sale",
        description: "Our big spring push",
        tags: ["promo", "seasonal"],
        sourceIndex: 0,
      },
    ]);
  });

  it("falls back to the Short link's last segment when there is no Key column", () => {
    const csv = "Short link,Destination URL\nhttps://dub.sh/promo,https://a.com";
    expect(dub.parse(csv).rows[0]!.slug).toBe("promo");
  });

  it("errors a row with no destination URL", () => {
    const r = dub.parse("Key,Title\nx,Just a title");
    expect(r.rows).toEqual([]);
    expect(r.errors[0]!.message).toContain("destination URL");
  });

  it("flags Created At / Clicks / Archived / Folder as dropped only when present", () => {
    const withMeta = dub.parse(
      "Key,Destination URL,Created At,Clicks,Archived,Folder\nx,https://a.com,2020-01-01,42,false,Marketing",
    );
    expect(withMeta.dropped.map((d) => d.field)).toEqual(["Created date", "Clicks", "Archived flag", "Folder"]);
    const lean = dub.parse("Key,Destination URL\nx,https://a.com");
    expect(lean.dropped).toEqual([]);
  });
});
