import { describe, expect, it } from "vitest";
import { loginRedirectFor, safeNext, withNext } from "./safe-next";

describe("loginRedirectFor (#775 — the auth guard must remember where you were going)", () => {
  it("carries the protected path, its query and its hash", () => {
    expect(loginRedirectFor({ pathname: "/links/lnk_123", search: "", hash: "" })).toBe(
      "/login?next=%2Flinks%2Flnk_123",
    );
    expect(loginRedirectFor({ pathname: "/analytics", search: "?range=30d&link=a", hash: "#top" })).toBe(
      "/login?next=%2Fanalytics%3Frange%3D30d%26link%3Da%23top",
    );
    // and the round trip through the login page lands exactly there
    const url = new URL(loginRedirectFor({ pathname: "/analytics", search: "?range=30d&link=a", hash: "" }), "https://x.invalid");
    expect(safeNext(url.searchParams.get("next"))).toBe("/analytics?range=30d&link=a");
  });

  it("keeps the plain /links home as an explicit next too (harmless, same result)", () => {
    expect(loginRedirectFor({ pathname: "/links", search: "", hash: "" })).toBe("/login?next=%2Flinks");
  });

  it.each([
    // A crafted URL on our own origin: location.pathname of https://app//evil.example is "//evil.example".
    [{ pathname: "//evil.example", search: "", hash: "" }],
    [{ pathname: "//evil.example/links", search: "?a=1", hash: "" }],
    [{ pathname: "/\\evil.example", search: "", hash: "" }],
    [{ pathname: "/%2F%2Fevil.example", search: "", hash: "" }],
    [{ pathname: "/..//evil.example", search: "", hash: "" }],
  ])("drops an unsafe current location to a bare /login: %j", (loc) => {
    expect(loginRedirectFor(loc)).toBe("/login");
  });

  it("never points at another auth page (no /login?next=/login loops)", () => {
    expect(loginRedirectFor({ pathname: "/login", search: "?next=%2Flinks", hash: "" })).toBe("/login");
    expect(loginRedirectFor({ pathname: "/register", search: "", hash: "" })).toBe("/login");
  });
});

describe("safeNext (#668 — post-auth redirect must not be an open redirect)", () => {
  it("keeps a same-origin path with its query intact", () => {
    expect(safeNext("/invite?token=abc_DEF-123")).toBe("/invite?token=abc_DEF-123");
    expect(safeNext("/team")).toBe("/team");
  });

  it.each([
    [null],
    [undefined],
    [""],
    ["https://evil.example/x"],
    ["//evil.example/x"],
    ["/\\evil.example/x"],
    ["\\\\evil.example"],
    ["javascript:alert(1)"],
    ["invite?token=x"],
    ["/x\nLocation: https://evil.example"],
    ["/x\u0000"],
  ])("falls back for %j", (raw) => {
    expect(safeNext(raw as string | null | undefined)).toBe("/links");
  });

  /* #699 — payloads that pass a raw-string check but NORMALISE into a
     protocol-relative "//host". Each of these returned "//evil.example" before
     the output was re-validated. */
  it.each([
    ["/..//evil.example"],
    ["/.//evil.example"],
    ["/%2e%2e//evil.example"],
    ["/%2E%2E//evil.example"],
    ["/%2e//evil.example"],
    ["/a/..//evil.example"],
    ["/a/b/../..//evil.example"],
    ["/./..//evil.example/login"],
    ["/..//evil.example/login?x=1"],
    ["/a/%2e%2e//evil.example"],
    ["/..///evil.example"],
  ])("falls back for normalisation bypass %j", (raw) => {
    expect(safeNext(raw)).toBe("/links");
    expect(withNext("/login", raw)).toBe("/login");
  });

  it("whatever it returns is never protocol-relative, for a sweep of dot-segment shapes", () => {
    const segs = ["", ".", "..", "%2e", "%2e%2e", "%2E%2e", "a", "a/.."];
    for (const a of segs)
      for (const b of segs)
        for (const tail of ["/evil.example", "//evil.example", "/\\evil.example"]) {
          const out = safeNext(`/${a}/${b}${tail}`);
          expect(out.startsWith("//") || out.startsWith("/\\"), `/${a}/${b}${tail} -> ${out}`).toBe(false);
          expect(new URL(out, "https://snapurl.invalid").origin).toBe("https://snapurl.invalid");
        }
  });

  it("still normalises a harmless dot-segment path to its same-origin target", () => {
    expect(safeNext("/a/../invite?token=x")).toBe("/invite?token=x");
  });

  /* #775 — the vectors the auth guard's `next` must survive. Every one of these
     either fails the raw check or normalises to something that is not a plain
     same-origin path, and must fall back. */
  it.each([
    // absolute and scheme URLs
    ["http://evil.example"],
    ["HTTPS://evil.example/links"],
    ["javascript:alert(1)"],
    ["JaVaScRiPt:alert(1)"],
    ["data:text/html,<script>alert(1)</script>"],
    ["vbscript:msgbox(1)"],
    [" javascript:alert(1)"],
    ["\tjavascript:alert(1)"],
    // protocol-relative and backslash
    ["//evil.example"],
    ["///evil.example"],
    ["/\\evil.example"],
    ["/\\/evil.example"],
    ["\\/evil.example"],
    ["/\\\\evil.example"],
    // percent-encoded slash / backslash, raw and in the path
    ["%2F%2Fevil.example"],
    ["%2f%2fevil.example"],
    ["%5C%5Cevil.example"],
    ["/%2F/evil.example"],
    ["/%2fevil.example"],
    ["/%5Cevil.example"],
    ["/%5cevil.example"],
    ["/links/%2F%2Fevil.example"],
    // CR / LF / tab / NUL, raw and encoded
    ["/links\r\nSet-Cookie: x=1"],
    ["/links\n"],
    ["/\t/evil.example"],
    ["/\n/evil.example"],
    ["/\r/evil.example"],
    ["/links%0d%0aSet-Cookie:x=1"],
    ["/links%0A"],
    ["/%00"],
    // userinfo / host tricks that are not paths at all
    ["evil.example"],
    ["@evil.example"],
    ["https:evil.example"],
    ["https:/evil.example"],
    ["./links"],
    ["../links"],
    ["?next=/links"],
    ["#/links"],
  ])("falls back for vector %j", (raw) => {
    const out = safeNext(raw);
    expect(out).toBe("/links");
  });

  it("keeps a query string that legitimately carries encoded slashes", () => {
    // The `?new=` deep link (#660) puts a whole URL in the query: that is data,
    // not a path, and must survive.
    expect(safeNext("/links?new=https%3A%2F%2Fexample.com%2Fa")).toBe("/links?new=https%3A%2F%2Fexample.com%2Fa");
    expect(safeNext("/analytics?range=30d#top")).toBe("/analytics?range=30d#top");
  });

  it("withNext encodes the target and drops an unsafe one", () => {
    expect(withNext("/login", "/invite?token=a&b")).toBe("/login?next=%2Finvite%3Ftoken%3Da%26b");
    expect(withNext("/register", "https://evil.example")).toBe("/register");
    expect(withNext("/login", null)).toBe("/login");
  });
});
