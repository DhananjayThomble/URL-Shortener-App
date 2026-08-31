import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { hasCredentials, loadSettings, normalizeApiBaseUrl, saveSettings } from "./storage.js";

/**
 * A minimal in-memory stand-in for chrome.storage.local. The real extension
 * runtime provides this; under vitest we mount just enough of it on globalThis
 * so the Settings layer can be exercised without a browser.
 */
function mountChromeStorage(): { store: Record<string, unknown> } {
  const store: Record<string, unknown> = {};
  const local = {
    get: vi.fn(async (keys?: string | string[] | Record<string, unknown> | null) => {
      if (keys == null) return { ...store };
      const names = typeof keys === "string" ? [keys] : Array.isArray(keys) ? keys : Object.keys(keys);
      const out: Record<string, unknown> = {};
      for (const name of names) if (name in store) out[name] = store[name];
      return out;
    }),
    set: vi.fn(async (items: Record<string, unknown>) => {
      Object.assign(store, items);
    }),
  };
  (globalThis as unknown as { chrome: unknown }).chrome = { storage: { local } };
  return { store };
}

describe("storage / settings", () => {
  beforeEach(() => {
    mountChromeStorage();
  });

  afterEach(() => {
    delete (globalThis as unknown as { chrome?: unknown }).chrome;
    vi.restoreAllMocks();
  });

  it("round-trips saved settings through chrome.storage.local", async () => {
    await saveSettings({ apiBaseUrl: "https://snapurl.example", apiKey: "snap_live_abc", defaultDomain: "snp.li" });
    const loaded = await loadSettings();
    expect(loaded.apiBaseUrl).toBe("https://snapurl.example");
    expect(loaded.apiKey).toBe("snap_live_abc");
    expect(loaded.defaultDomain).toBe("snp.li");
  });

  it("normalizes the api base url on save (strips trailing slash)", async () => {
    await saveSettings({ apiBaseUrl: "https://snapurl.example/", apiKey: "snap_live_abc" });
    const loaded = await loadSettings();
    expect(loaded.apiBaseUrl).toBe("https://snapurl.example");
  });

  it("rejects a non-http(s) base url", () => {
    expect(() => normalizeApiBaseUrl("ftp://snapurl.example")).toThrow();
    expect(() => normalizeApiBaseUrl("javascript:alert(1)")).toThrow();
    expect(normalizeApiBaseUrl("http://localhost:3000/")).toBe("http://localhost:3000");
  });

  it("hasCredentials is false when the api key is missing or blank", () => {
    expect(hasCredentials({ apiBaseUrl: "https://snapurl.example", apiKey: "" })).toBe(false);
    expect(hasCredentials({ apiBaseUrl: "https://snapurl.example", apiKey: "   " })).toBe(false);
    expect(hasCredentials({ apiBaseUrl: "https://snapurl.example", apiKey: "snap_live_abc" })).toBe(true);
  });

  it("never logs the api key", async () => {
    const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    const errSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    const infoSpy = vi.spyOn(console, "info").mockImplementation(() => {});

    await saveSettings({ apiBaseUrl: "https://snapurl.example", apiKey: "snap_live_secret" });
    await loadSettings();

    const everything = [logSpy, errSpy, warnSpy, infoSpy]
      .flatMap((spy) => spy.mock.calls)
      .map((args) => JSON.stringify(args))
      .join(" ");
    expect(everything).not.toContain("snap_live_secret");
  });
});
