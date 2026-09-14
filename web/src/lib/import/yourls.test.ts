import { describe, expect, it } from "vitest";
import { yourls } from "./sources/yourls";

describe("yourls source", () => {
  it("maps url + bare keyword + title", () => {
    const csv = "keyword,url,title,timestamp,ip,clicks\npromo,https://acme.com/spring,Spring,2020-01-01 00:00:00,1.2.3.4,42";
    const r = yourls.parse(csv);
    expect(r.errors).toEqual([]);
    expect(r.rows).toEqual([
      { destination: "https://acme.com/spring", slug: "promo", title: "Spring", sourceIndex: 0 },
    ]);
  });

  it("keeps the keyword verbatim (it is a bare back-half, not a URL)", () => {
    const r = yourls.parse("keyword,url\nabc123,https://a.com");
    expect(r.rows[0]!.slug).toBe("abc123");
  });

  it("errors a row with no url", () => {
    const r = yourls.parse("keyword,title\npromo,Just a title");
    expect(r.rows).toEqual([]);
    expect(r.errors[0]!.message).toContain("url");
  });

  it("flags timestamp/clicks/ip as dropped only when present", () => {
    const withMeta = yourls.parse("keyword,url,timestamp,clicks,ip\np,https://a.com,2020-01-01,9,1.2.3.4");
    expect(withMeta.dropped.map((d) => d.field)).toEqual(["Timestamp", "Clicks", "Creator IP"]);
    const lean = yourls.parse("keyword,url\np,https://a.com");
    expect(lean.dropped).toEqual([]);
  });
});
