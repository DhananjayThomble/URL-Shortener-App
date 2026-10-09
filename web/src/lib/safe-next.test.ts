import { describe, expect, it } from "vitest";
import { safeNext, withNext } from "./safe-next";

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

  it("withNext encodes the target and drops an unsafe one", () => {
    expect(withNext("/login", "/invite?token=a&b")).toBe("/login?next=%2Finvite%3Ftoken%3Da%26b");
    expect(withNext("/register", "https://evil.example")).toBe("/register");
    expect(withNext("/login", null)).toBe("/login");
  });
});
