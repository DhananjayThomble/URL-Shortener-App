import { describe, expect, it } from "vitest";
import { parseCsv, parseCsvRecords, pick, normalizeHeader } from "./csv";
import { genericCsv } from "./sources/generic-csv";
import { prepareRows, chunk, BATCH_SIZE, COMMENT_MAX } from "./to-links";
import type { MappedRow } from "./types";

describe("parseCsv", () => {
  it("splits simple rows and cells", () => {
    expect(parseCsv("a,b\n1,2")).toEqual([["a", "b"], ["1", "2"]]);
  });

  it("keeps commas inside quoted fields", () => {
    // A destination with a query string full of commas is the whole reason a
    // naive split(',') is wrong.
    const rows = parseCsv('url,title\n"https://a.com/x?a=1,b=2","Hello, world"');
    expect(rows[1]).toEqual(["https://a.com/x?a=1,b=2", "Hello, world"]);
  });

  it("handles escaped quotes and embedded newlines", () => {
    const rows = parseCsv('a\n"say ""hi""\nagain"');
    expect(rows[1]).toEqual(['say "hi"\nagain']);
  });

  it("handles CRLF and a trailing newline without an empty row", () => {
    expect(parseCsv("a,b\r\n1,2\r\n")).toEqual([["a", "b"], ["1", "2"]]);
  });

  it("returns [] for empty input", () => {
    expect(parseCsv("")).toEqual([]);
    expect(parseCsv("\n")).toEqual([]);
  });
});

describe("parseCsvRecords + pick", () => {
  it("keys by normalized header and matches aliases", () => {
    const recs = parseCsvRecords("Long URL,Back-Half\nhttps://a.com,spring");
    expect(recs).toHaveLength(1);
    expect(pick(recs[0]!, ["long url"])).toBe("https://a.com");
    expect(pick(recs[0]!, ["back half"])).toBe("spring");
    expect(pick(recs[0]!, ["missing"])).toBe("");
  });

  it("normalizeHeader collapses case, whitespace, dashes and underscores", () => {
    expect(normalizeHeader(" Long_URL ")).toBe("long url");
    expect(normalizeHeader("Back-Half")).toBe("back half");
  });

  it("returns [] when there is a header but no data row", () => {
    expect(parseCsvRecords("url,title")).toEqual([]);
  });
});

describe("genericCsv source", () => {
  it("maps destination, slug, title and tags", () => {
    const r = genericCsv.parse(
      "long_url,back_half,title,tags\nhttps://acme.com/spring,spring-sale,Spring Sale,\"promo, seasonal\"",
    );
    expect(r.errors).toEqual([]);
    expect(r.rows).toEqual([
      {
        destination: "https://acme.com/spring",
        slug: "spring-sale",
        title: "Spring Sale",
        tags: ["promo", "seasonal"],
        sourceIndex: 0,
      },
    ]);
  });

  it("errors a row with no destination instead of dropping it silently", () => {
    const r = genericCsv.parse("title\nJust a title");
    expect(r.rows).toEqual([]);
    expect(r.errors).toEqual([{ sourceIndex: 0, message: expect.stringContaining("No destination") }]);
  });

  it("flags dropped fields only when the export carried them", () => {
    const withMeta = genericCsv.parse("url,created,clicks\nhttps://a.com,2020-01-01,42");
    expect(withMeta.dropped.map((d) => d.field)).toEqual(["Original created date", "Click history"]);

    const without = genericCsv.parse("url\nhttps://a.com");
    expect(without.dropped).toEqual([]);
  });
});

describe("prepareRows policy", () => {
  const base: MappedRow = { destination: "https://a.com", sourceIndex: 0 };

  it("applies the chosen domain and safe CreateLinkInput defaults", () => {
    const [p] = prepareRows([base], "snapurl.in");
    expect(p!.input.domain).toBe("snapurl.in");
    expect(p!.input.redirectType).toBe("302");
    expect(p!.input.forwardQuery).toBe(true);
    expect(p!.input.tags).toEqual([]);
  });

  it("keeps a valid back-half but drops one the contract rejects", () => {
    const ok = prepareRows([{ ...base, slug: "spring-sale.v2" }], "snapurl.in")[0]!;
    expect(ok.input.slug).toBe("spring-sale.v2");
    expect(ok.slugRewritten).toBe(false);

    const bad = prepareRows([{ ...base, slug: "no spaces!" }], "snapurl.in")[0]!;
    expect(bad.input.slug).toBeUndefined();
    expect(bad.slugRewritten).toBe(true);
  });

  it("maps title to comment truncated to the contract max", () => {
    const long = "x".repeat(400);
    const [p] = prepareRows([{ ...base, title: long }], "snapurl.in");
    expect(p!.input.comment).toHaveLength(COMMENT_MAX);
  });
});

describe("chunk", () => {
  it("splits into batches no larger than the bulk cap", () => {
    const items = Array.from({ length: 250 }, (_, i) => i);
    const batches = chunk(items);
    expect(batches.map((b) => b.length)).toEqual([BATCH_SIZE, BATCH_SIZE, 50]);
  });

  it("returns [] for no items", () => {
    expect(chunk([])).toEqual([]);
  });
});
