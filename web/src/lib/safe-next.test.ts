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

  it("withNext encodes the target and drops an unsafe one", () => {
    expect(withNext("/login", "/invite?token=a&b")).toBe("/login?next=%2Finvite%3Ftoken%3Da%26b");
    expect(withNext("/register", "https://evil.example")).toBe("/register");
    expect(withNext("/login", null)).toBe("/login");
  });
});
