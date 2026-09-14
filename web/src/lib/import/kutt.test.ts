import { describe, expect, it } from "vitest";
import { kutt } from "./sources/kutt";

describe("kutt source", () => {
  it("maps a bare JSON array: target, address, description, expiration", () => {
    const json = JSON.stringify([
      { address: "promo", target: "https://acme.com/spring", description: "Spring", expiration: "2030-01-01T00:00:00.000Z" },
    ]);
    const r = kutt.parse(json);
    expect(r.errors).toEqual([]);
    expect(r.rows).toEqual([
      {
        destination: "https://acme.com/spring",
        slug: "promo",
        title: "Spring",
        expiresAt: "2030-01-01T00:00:00.000Z",
        sourceIndex: 0,
      },
    ]);
  });

  it("accepts a { data: [...] } envelope", () => {
    const json = JSON.stringify({ data: [{ address: "x", target: "https://a.com" }] });
    expect(kutt.parse(json).rows).toHaveLength(1);
  });

  it("errors non-JSON and non-array JSON clearly", () => {
    expect(kutt.parse("keyword,url\np,https://a.com").errors[0]!.message).toContain("not valid JSON");
    expect(kutt.parse('{"foo":"bar"}').errors[0]!.message).toContain("array of links");
  });

  it("errors a link with no target", () => {
    const r = kutt.parse(JSON.stringify([{ address: "x" }]));
    expect(r.rows).toEqual([]);
    expect(r.errors[0]!.message).toContain("no target");
  });

  it("normalizes a non-ISO expiration and drops an unparseable one", () => {
    const ok = kutt.parse(JSON.stringify([{ target: "https://a.com", expiration: "2030-06-15" }]));
    expect(ok.rows[0]!.expiresAt).toBe(new Date("2030-06-15").toISOString());
    const bad = kutt.parse(JSON.stringify([{ target: "https://a.com", expiration: "whenever" }]));
    expect(bad.rows[0]!.expiresAt).toBeUndefined();
  });

  it("flags created_at / visit_count / banned as dropped only when present", () => {
    const withMeta = kutt.parse(JSON.stringify([{ target: "https://a.com", created_at: "2020-01-01", visit_count: 9, banned: false }]));
    expect(withMeta.dropped.map((d) => d.field)).toEqual(["Created date", "Visit count", "Banned flag"]);
    const lean = kutt.parse(JSON.stringify([{ target: "https://a.com" }]));
    expect(lean.dropped).toEqual([]);
  });
});
