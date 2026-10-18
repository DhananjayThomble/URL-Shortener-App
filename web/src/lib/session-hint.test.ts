import { describe, expect, it } from "vitest";
import {
  ACCESS_TOKEN_KEY,
  PREPAINT_SESSION_HINT,
  REFRESH_TOKEN_KEY,
  SESSION_HINT_ATTR,
  applySessionHint,
  hasSessionHint,
} from "./session-hint";
import { signedInTarget } from "./safe-next";

/** A stand-in for document.documentElement that records attributes. */
function fakeRoot() {
  const attrs = new Map<string, string>();
  return {
    attrs,
    setAttribute: (k: string, v: string) => void attrs.set(k, v),
    removeAttribute: (k: string) => void attrs.delete(k),
  };
}

const storageOf = (items: Record<string, string>) => (key: string) => items[key] ?? null;

describe("hasSessionHint (#777 — is there a stored session at all?)", () => {
  it("is true with a refresh token, an access token, or both", () => {
    expect(hasSessionHint(storageOf({ [REFRESH_TOKEN_KEY]: "r" }))).toBe(true);
    expect(hasSessionHint(storageOf({ [ACCESS_TOKEN_KEY]: "a" }))).toBe(true);
    expect(hasSessionHint(storageOf({ [ACCESS_TOKEN_KEY]: "a", [REFRESH_TOKEN_KEY]: "r" }))).toBe(true);
  });

  it("is false for no tokens, empty-string tokens, or unrelated keys", () => {
    expect(hasSessionHint(storageOf({}))).toBe(false);
    expect(hasSessionHint(storageOf({ [ACCESS_TOKEN_KEY]: "", [REFRESH_TOKEN_KEY]: "" }))).toBe(false);
    expect(hasSessionHint(storageOf({ "snapurl.appearance": "{}" }))).toBe(false);
  });

  it("is false (not a throw) when storage is unavailable", () => {
    expect(hasSessionHint(null)).toBe(false);
    expect(
      hasSessionHint(() => {
        throw new Error("SecurityError");
      }),
    ).toBe(false);
  });
});

describe("applySessionHint", () => {
  it("sets the attribute when signed in and removes it when not", () => {
    const root = fakeRoot();
    applySessionHint(root, true);
    expect(root.attrs.get(SESSION_HINT_ATTR)).toBe("in");
    applySessionHint(root, false);
    expect(root.attrs.has(SESSION_HINT_ATTR)).toBe(false);
  });
});

describe("PREPAINT_SESSION_HINT (the inline script that runs before first paint)", () => {
  /** Evaluate the real snippet against fake localStorage / document. */
  function run(items: Record<string, string> | "throws") {
    const root = fakeRoot();
    const localStorage = {
      getItem: (k: string) => {
        if (items === "throws") throw new Error("SecurityError");
        return items[k] ?? null;
      },
    };
    new Function("localStorage", "document", PREPAINT_SESSION_HINT)(localStorage, { documentElement: root });
    return root.attrs.get(SESSION_HINT_ATTR);
  }

  it("marks the page when either token is stored", () => {
    expect(run({ [REFRESH_TOKEN_KEY]: "r" })).toBe("in");
    expect(run({ [ACCESS_TOKEN_KEY]: "a" })).toBe("in");
  });

  it("leaves the page alone when signed out, and never throws when storage is blocked", () => {
    expect(run({})).toBeUndefined();
    expect(run("throws")).toBeUndefined();
  });

  it("uses the same storage keys as the API client", () => {
    expect(ACCESS_TOKEN_KEY).toBe("snapurl.accessToken");
    expect(REFRESH_TOKEN_KEY).toBe("snapurl.refreshToken");
  });
});

describe("signedInTarget (#777 — where a signed-in visitor on /login or /register goes)", () => {
  it("defaults to the dashboard", () => {
    expect(signedInTarget(null)).toBe("/links");
    expect(signedInTarget(undefined)).toBe("/links");
    expect(signedInTarget("")).toBe("/links");
  });

  it("honours a safe ?next= with its query and hash", () => {
    expect(signedInTarget("/settings")).toBe("/settings");
    expect(signedInTarget("/invite?token=abc_DEF-123")).toBe("/invite?token=abc_DEF-123");
    expect(signedInTarget("/analytics?range=30d#top")).toBe("/analytics?range=30d#top");
  });

  it.each([
    ["https://evil.example/x"],
    ["//evil.example"],
    ["/\\evil.example"],
    ["javascript:alert(1)"],
    ["/%2F%2Fevil.example"],
    ["/..//evil.example"],
    ["/x\r\nSet-Cookie: a=b"],
  ])("never follows an unsafe next: %j", (raw) => {
    expect(signedInTarget(raw)).toBe("/links");
  });

  it.each([
    ["/login"],
    ["/login?next=%2Fsettings"],
    ["/register"],
    ["/register#x"],
    ["/login/"],
  ])("never points back at an auth page (no redirect loop): %j", (raw) => {
    expect(signedInTarget(raw)).toBe("/links");
  });

  it("still allows a path that merely starts with the same letters", () => {
    expect(signedInTarget("/login-help")).toBe("/login-help");
    expect(signedInTarget("/links?next=/login")).toBe("/links?next=/login");
  });
});
