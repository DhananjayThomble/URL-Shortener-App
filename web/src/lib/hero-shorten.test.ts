import { describe, expect, it } from "vitest";
import { heroShortenTarget, isPlausibleHttpUrl, NEW_LINK_QUERY_PARAM } from "./hero-shorten";
import { safeNext } from "./safe-next";

describe("isPlausibleHttpUrl (#660 — hero accepts a web URL, rejects obvious non-URLs)", () => {
  it.each([
    "https://acme.com/collections/spring-2026?utm_source=instagram",
    "http://example.com",
    "acme.com/sale",
    "acme.com",
    "sub.acme.co.uk/a/b?x=1#frag",
  ])("accepts %j", (raw) => {
    expect(isPlausibleHttpUrl(raw)).toBe(true);
  });

  it.each([
    "",
    "   ",
    "not a url",
    "localhost-with-no-dot",
    "javascript:alert(1)",
    "mailto:a@b.com",
    "ftp://files.example.com",
    "data:text/html,hi",
    "http://",
    "acme com/sale", // space in host
  ])("rejects %j", (raw) => {
    expect(isPlausibleHttpUrl(raw)).toBe(false);
  });

  it("trims surrounding whitespace before judging", () => {
    expect(isPlausibleHttpUrl("  https://acme.com  ")).toBe(true);
  });
});

describe("heroShortenTarget (#660 — carry the pasted URL through to the drawer)", () => {
  const url = "https://acme.com/collections/spring-2026?utm_source=instagram&a=1";

  it("sends a signed-in visitor straight to the links drawer, URL encoded once", () => {
    const target = heroShortenTarget(url, true);
    expect(target).toBe(`/links?${NEW_LINK_QUERY_PARAM}=${encodeURIComponent(url)}`);
    // The query is recoverable intact.
    const parsed = new URL(target, "https://snapurl.invalid");
    expect(parsed.pathname).toBe("/links");
    expect(parsed.searchParams.get(NEW_LINK_QUERY_PARAM)).toBe(url);
  });

  it("sends a signed-out visitor to register with the drawer deep link as next", () => {
    const target = heroShortenTarget(url, false);
    expect(target.startsWith("/register?next=")).toBe(true);
    const parsed = new URL(target, "https://snapurl.invalid");
    expect(parsed.pathname).toBe("/register");
    const next = parsed.searchParams.get("next");
    expect(next).toBe(`/links?${NEW_LINK_QUERY_PARAM}=${encodeURIComponent(url)}`);
  });

  /* The whole point of #660: the `next` the hero writes must survive the exact
     safeNext() the register/login/Google paths run it through, with the pasted
     URL still intact at the end. */
  it("produces a next that safeNext accepts and preserves the pasted URL through it", () => {
    const target = heroShortenTarget(url, false);
    const next = new URL(target, "https://snapurl.invalid").searchParams.get("next");
    const landed = safeNext(next);
    expect(landed).toBe(`/links?${NEW_LINK_QUERY_PARAM}=${encodeURIComponent(url)}`);
    // And the drawer can read the original URL back off the landed path.
    const recovered = new URL(landed, "https://snapurl.invalid").searchParams.get(NEW_LINK_QUERY_PARAM);
    expect(recovered).toBe(url);
  });

  it("trims the URL before encoding", () => {
    expect(heroShortenTarget("  https://acme.com  ", true)).toBe(
      `/links?${NEW_LINK_QUERY_PARAM}=${encodeURIComponent("https://acme.com")}`,
    );
  });

  it("adds https:// to a bare host so the drawer is prefilled with a valid destination", () => {
    expect(heroShortenTarget("acme.com/sale", true)).toBe(
      `/links?${NEW_LINK_QUERY_PARAM}=${encodeURIComponent("https://acme.com/sale")}`,
    );
    expect(heroShortenTarget("http://acme.com", true)).toBe(
      `/links?${NEW_LINK_QUERY_PARAM}=${encodeURIComponent("http://acme.com")}`,
    );
  });
});
