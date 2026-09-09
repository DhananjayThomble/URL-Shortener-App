import { describe, expect, it, vi, afterEach } from "vitest";
import { compact, inr, pct, shortUrl, faviconFor, relativeDate, formatDate } from "./utils";

/* First tests for web/ (issue #351). These are the pure formatting helpers the
   dashboard renders numbers, money and links with — worth pinning because a
   silent change to any of them is a wrong figure on every table. */

describe("compact", () => {
  it("keeps small numbers verbatim", () => {
    expect(compact(0)).toBe("0");
    expect(compact(999)).toBe("999");
  });
  it("abbreviates thousands and millions", () => {
    expect(compact(84_392)).toBe("84.4k");
    expect(compact(1_500_000)).toBe("1.5M");
  });
  it("handles negatives by magnitude", () => {
    expect(compact(-2_000)).toBe("-2.0k");
  });
});

describe("inr", () => {
  it("formats lakh and crore thresholds", () => {
    expect(inr(100_000)).toBe("₹1.0L");
    expect(inr(10_000_000)).toBe("₹1.0Cr");
  });
  it("uses en-IN grouping below a lakh", () => {
    expect(inr(1999)).toBe("₹1,999");
  });
});

describe("pct", () => {
  it("fixes to one digit by default and keeps the sign", () => {
    expect(pct(28.9)).toBe("28.9%");
    expect(pct(-3.25, 2)).toBe("-3.25%");
  });
});

describe("shortUrl", () => {
  it("joins domain and slug with a slash", () => {
    expect(shortUrl("localhost:3002", "spring-sale")).toBe("localhost:3002/spring-sale");
  });
});

describe("faviconFor", () => {
  it("maps known hosts (ignoring www.) and falls back to a link glyph", () => {
    expect(faviconFor("https://www.acme.com/x")).toBe("🛍");
    expect(faviconFor("https://calendly.com/acme/demo")).toBe("🗓");
    expect(faviconFor("https://unknown.example/x")).toBe("🔗");
  });
  it("never throws on a malformed URL", () => {
    expect(faviconFor("not a url")).toBe("🔗");
  });
});

describe("relativeDate / formatDate", () => {
  afterEach(() => vi.useRealTimers());
  it("returns 'just now' within a minute and hours/days beyond", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-09-09T12:00:00.000Z"));
    expect(relativeDate("2026-09-09T11:59:40.000Z")).toBe("just now");
    expect(relativeDate("2026-09-09T09:00:00.000Z")).toBe("3 hours ago");
    expect(relativeDate("2026-09-07T12:00:00.000Z")).toBe("2 days ago");
  });
  it("echoes an unparseable input back unchanged", () => {
    expect(relativeDate("not-a-date")).toBe("not-a-date");
    expect(formatDate("not-a-date")).toBe("not-a-date");
  });
});
