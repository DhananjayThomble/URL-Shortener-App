import { beforeEach, describe, expect, it, vi } from "vitest";

import { Link } from "@snapurl/contract";

import {
  CONTEXT_MENU_ID,
  contextTargetUrl,
  handleInstalled,
  registerContextMenu,
  shortenInBackground,
} from "./background.js";
import type { BackgroundDeps } from "./background.js";
import { setFallbackMessages } from "./lib/i18n.js";
import type { Settings } from "./lib/storage.js";

/*
 * Background service-worker tests. The worker's side effects are injected via
 * BackgroundDeps, so the context-menu shorten flow (F1) and the install seeding
 * run headlessly without a chrome global. i18n fallbacks are registered so
 * notification assertions read as real strings rather than message keys.
 */

setFallbackMessages({
  bg_copied: "Short link copied: $1",
  bg_needs_config: "Add your SnapURL API key in the extension options first.",
  bg_needs_domain: "Set a default short domain in the extension options first.",
});

const configured: Settings = {
  apiBaseUrl: "https://snapurl.example",
  apiKey: "snap_live_secret",
  defaultDomain: "snp.li",
};

const sampleLink = Link.parse({
  id: "lnk_1",
  domain: "snp.li",
  slug: "abc",
  destination: "https://example.com/",
  status: "active",
  clicks: 0,
  safeBrowsing: { status: "clean", checkedAt: "2024-01-01T00:00:00.000Z" },
  createdAt: "2024-01-01T00:00:00.000Z",
});

function makeDeps(overrides: Partial<BackgroundDeps> = {}): BackgroundDeps {
  return {
    loadSettings: vi.fn(async () => configured),
    createLink: vi.fn(async () => sampleLink),
    shortUrlOf: vi.fn(() => "https://snp.li/abc"),
    copyToClipboard: vi.fn(async () => {}),
    notify: vi.fn(() => {}),
    openOptions: vi.fn(() => {}),
    ...overrides,
  };
}

describe("contextTargetUrl", () => {
  it("prefers a right-clicked link over the page url", () => {
    expect(contextTargetUrl({ linkUrl: "https://a.test/x", pageUrl: "https://b.test/" })).toBe("https://a.test/x");
  });
  it("falls back to the page url", () => {
    expect(contextTargetUrl({ pageUrl: "https://b.test/" })).toBe("https://b.test/");
  });
  it("rejects non-http(s) targets", () => {
    expect(contextTargetUrl({ pageUrl: "chrome://extensions" })).toBeUndefined();
    expect(contextTargetUrl({})).toBeUndefined();
  });
});

describe("shortenInBackground", () => {
  it("creates a link, copies the short url, and notifies success", async () => {
    const deps = makeDeps();
    await shortenInBackground(deps, "https://example.com/page");
    expect(deps.createLink).toHaveBeenCalledTimes(1);
    const [, params] = (deps.createLink as ReturnType<typeof vi.fn>).mock.calls[0]!;
    expect(params.destination).toBe("https://example.com/page");
    expect(params.domain).toBe("snp.li");
    expect(deps.copyToClipboard).toHaveBeenCalledWith("https://snp.li/abc");
    expect(deps.notify).toHaveBeenCalledWith(expect.stringContaining("https://snp.li/abc"), false);
  });

  it("notifies and opens options when there are no credentials", async () => {
    const deps = makeDeps({ loadSettings: vi.fn(async () => ({ apiBaseUrl: "", apiKey: "" })) });
    await shortenInBackground(deps, "https://example.com/page");
    expect(deps.createLink).not.toHaveBeenCalled();
    expect(deps.openOptions).toHaveBeenCalledTimes(1);
    expect(deps.notify).toHaveBeenCalledWith(expect.any(String), true);
  });

  it("notifies and opens options when no default domain is set", async () => {
    const deps = makeDeps({ loadSettings: vi.fn(async () => ({ ...configured, defaultDomain: undefined })) });
    await shortenInBackground(deps, "https://example.com/page");
    expect(deps.createLink).not.toHaveBeenCalled();
    expect(deps.openOptions).toHaveBeenCalledTimes(1);
    expect(deps.notify).toHaveBeenCalledWith(expect.any(String), true);
  });

  it("turns a create failure into an error notification, never throwing", async () => {
    const deps = makeDeps({
      createLink: vi.fn(async () => {
        throw new Error("boom");
      }),
    });
    await expect(shortenInBackground(deps, "https://example.com/page")).resolves.toBeUndefined();
    expect(deps.notify).toHaveBeenCalledWith("boom", true);
  });
});

describe("registerContextMenu", () => {
  it("clears existing menus then creates the shorten entry", () => {
    const create = vi.fn();
    const removeAll = vi.fn((cb: () => void) => cb());
    registerContextMenu({ removeAll, create } as unknown as typeof chrome.contextMenus);
    expect(removeAll).toHaveBeenCalledTimes(1);
    expect(create).toHaveBeenCalledTimes(1);
    const arg = create.mock.calls[0]![0];
    expect(arg.id).toBe(CONTEXT_MENU_ID);
    expect(arg.contexts).toEqual(["page", "link"]);
  });
});

describe("handleInstalled", () => {
  beforeEach(() => {
    const store: Record<string, unknown> = {};
    const openOptionsPage = vi.fn(async () => {});
    (globalThis as unknown as { chrome: unknown }).chrome = {
      storage: {
        local: {
          get: vi.fn(async (key: string) => ({ [key]: store[key] })),
          set: vi.fn(async (items: Record<string, unknown>) => {
            Object.assign(store, items);
          }),
        },
      },
      runtime: { openOptionsPage },
    };
  });

  it("seeds empty settings and opens options on a fresh install", async () => {
    await handleInstalled({ reason: "install" } as chrome.runtime.InstalledDetails);
    expect((globalThis as unknown as { chrome: { runtime: { openOptionsPage: ReturnType<typeof vi.fn> } } }).chrome.runtime.openOptionsPage).toHaveBeenCalledTimes(1);
  });

  it("does nothing on an update", async () => {
    await handleInstalled({ reason: "update" } as chrome.runtime.InstalledDetails);
    expect((globalThis as unknown as { chrome: { runtime: { openOptionsPage: ReturnType<typeof vi.fn> } } }).chrome.runtime.openOptionsPage).not.toHaveBeenCalled();
  });
});
