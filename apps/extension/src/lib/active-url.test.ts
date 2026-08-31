import { describe, expect, it } from "vitest";

import { shortenableUrl } from "./active-url.js";

describe("active-url / shortenableUrl", () => {
  it("accepts http and https urls", () => {
    expect(shortenableUrl("https://example.com/path?q=1")).toEqual({
      ok: true,
      url: "https://example.com/path?q=1",
    });
    expect(shortenableUrl("http://example.com")).toEqual({ ok: true, url: "http://example.com" });
  });

  it("rejects chrome:// pages", () => {
    const result = shortenableUrl("chrome://settings");
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toMatch(/browser|internal|shorten/i);
  });

  it("rejects extension pages", () => {
    expect(shortenableUrl("chrome-extension://abcdef/popup.html").ok).toBe(false);
  });

  it("rejects about: pages", () => {
    expect(shortenableUrl("about:blank").ok).toBe(false);
  });

  it("rejects file: urls", () => {
    expect(shortenableUrl("file:///Users/me/notes.txt").ok).toBe(false);
  });

  it("rejects empty or missing urls with a reason", () => {
    const result = shortenableUrl(undefined);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(typeof result.reason).toBe("string");
  });

  it("rejects malformed urls", () => {
    expect(shortenableUrl("not a url").ok).toBe(false);
  });
});
