import { beforeEach, describe, expect, it, vi } from "vitest";

import { Link } from "@snapurl/contract";

import { AuthError, RateLimitError } from "./lib/api-client.js";
import { browserShortUrlOf, createPopup, POPUP_MARKUP } from "./popup.js";
import type { PopupDeps } from "./popup.js";
import type { Settings } from "./lib/storage.js";

/*
 * Popup controller DOM tests.
 *
 * The popup is the extension's whole surface, so its render states are the
 * contract. Every dependency (settings, api client, the active tab, the
 * clipboard, opening a tab) is injected, so the controller can be driven
 * headlessly under happy-dom without a real browser or network.
 */

const configured: Settings = {
  apiBaseUrl: "https://snapurl.example",
  apiKey: "snap_live_secret",
  defaultDomain: "snp.li",
};

// Parse through the contract so the mocks return a complete, typed Link.
const sampleLink = Link.parse({
  id: "lnk_1",
  domain: "snp.li",
  slug: "abc",
  destination: "https://example.com/",
  status: "active",
  clicks: 3,
  safeBrowsing: { status: "clean", checkedAt: "2024-01-01T00:00:00.000Z" },
  createdAt: "2024-01-01T00:00:00.000Z",
});

function shortUrlOf(link: { domain: string; slug: string }): string {
  return `https://${link.domain}/${link.slug}`;
}

function mountDom(): HTMLElement {
  document.body.innerHTML = POPUP_MARKUP;
  return document.body;
}

function makeDeps(overrides: Partial<PopupDeps> = {}): PopupDeps {
  return {
    loadSettings: vi.fn(async () => configured),
    getActiveTabUrl: vi.fn(async () => "https://example.com/page"),
    createLink: vi.fn(async () => sampleLink),
    listLinks: vi.fn(async () => ({ items: [sampleLink], total: 1, nextCursor: null })),
    copyToClipboard: vi.fn(async () => {}),
    openUrl: vi.fn(() => {}),
    openOptions: vi.fn(() => {}),
    shortUrlOf,
    ...overrides,
  };
}

async function flush(): Promise<void> {
  await Promise.resolve();
  await Promise.resolve();
  await new Promise((r) => setTimeout(r, 0));
}

describe("popup controller", () => {
  beforeEach(() => {
    mountDom();
    vi.clearAllMocks();
  });

  it("shows a configuration prompt linking to options when there are no credentials", async () => {
    const deps = makeDeps({ loadSettings: vi.fn(async () => ({ apiBaseUrl: "", apiKey: "" })) });
    await createPopup(document, deps);
    await flush();

    const prompt = document.querySelector<HTMLElement>('[data-testid="needs-config"]');
    expect(prompt).not.toBeNull();
    expect(prompt?.hidden).toBe(false);

    const link = prompt?.querySelector<HTMLButtonElement>('[data-action="open-options"]');
    expect(link).not.toBeNull();
    link?.click();
    expect(deps.openOptions).toHaveBeenCalledTimes(1);

    // The shorten UI stays hidden without credentials.
    expect(document.querySelector<HTMLElement>('[data-testid="shorten"]')?.hidden).toBe(true);
  });

  it("shows a non-shortenable message for internal pages", async () => {
    const deps = makeDeps({ getActiveTabUrl: vi.fn(async () => "chrome://extensions") });
    await createPopup(document, deps);
    await flush();

    const notice = document.querySelector<HTMLElement>('[data-testid="not-shortenable"]');
    expect(notice?.hidden).toBe(false);
    expect(document.querySelector<HTMLButtonElement>('[data-action="shorten"]')?.hidden).toBe(true);
  });

  it("warns when no default domain is configured", async () => {
    const deps = makeDeps({ loadSettings: vi.fn(async () => ({ ...configured, defaultDomain: undefined })) });
    await createPopup(document, deps);
    await flush();

    const notice = document.querySelector<HTMLElement>('[data-testid="needs-domain"]');
    expect(notice?.hidden).toBe(false);
    expect(document.querySelector<HTMLButtonElement>('[data-action="shorten"]')?.hidden).toBe(true);
  });

  it("shortens the active tab and renders the short url with copy and open actions", async () => {
    const deps = makeDeps();
    await createPopup(document, deps);
    await flush();

    const button = document.querySelector<HTMLButtonElement>('[data-action="shorten"]');
    expect(button).not.toBeNull();
    expect(button?.hidden).toBe(false);

    button?.click();
    await flush();

    expect(deps.createLink).toHaveBeenCalledTimes(1);
    const [, params] = (deps.createLink as ReturnType<typeof vi.fn>).mock.calls[0]!;
    expect(params.destination).toBe("https://example.com/page");
    expect(params.domain).toBe("snp.li");

    const result = document.querySelector<HTMLElement>('[data-testid="result"]');
    expect(result?.hidden).toBe(false);
    const shown = document.querySelector<HTMLElement>('[data-testid="short-url"]');
    expect(shown?.textContent).toContain("https://snp.li/abc");

    document.querySelector<HTMLButtonElement>('[data-action="copy"]')?.click();
    await flush();
    expect(deps.copyToClipboard).toHaveBeenCalledWith("https://snp.li/abc");

    document.querySelector<HTMLButtonElement>('[data-action="open"]')?.click();
    expect(deps.openUrl).toHaveBeenCalledWith("https://snp.li/abc");
  });

  it("shows a loading state while shortening", async () => {
    let resolve!: (v: typeof sampleLink) => void;
    const deps = makeDeps({
      createLink: vi.fn(() => new Promise<typeof sampleLink>((r) => (resolve = r))),
    });
    await createPopup(document, deps);
    await flush();

    document.querySelector<HTMLButtonElement>('[data-action="shorten"]')?.click();
    await flush();
    expect(document.querySelector<HTMLElement>('[data-testid="shorten-loading"]')?.hidden).toBe(false);

    resolve(sampleLink);
    await flush();
    expect(document.querySelector<HTMLElement>('[data-testid="shorten-loading"]')?.hidden).toBe(true);
  });

  it("renders recent links from listLinks", async () => {
    const deps = makeDeps();
    await createPopup(document, deps);
    await flush();

    const recent = document.querySelector<HTMLElement>('[data-testid="recent"]');
    expect(recent?.hidden).toBe(false);
    const items = recent?.querySelectorAll('[data-testid="recent-item"]');
    expect(items?.length).toBe(1);
    expect(recent?.textContent).toContain("https://snp.li/abc");
  });

  it("shows an empty state when there are no recent links", async () => {
    const deps = makeDeps({ listLinks: vi.fn(async () => ({ items: [], total: 0, nextCursor: null })) });
    await createPopup(document, deps);
    await flush();

    expect(document.querySelector<HTMLElement>('[data-testid="recent-empty"]')?.hidden).toBe(false);
  });

  it("shows an auth-failure state when shortening is rejected", async () => {
    const deps = makeDeps({ createLink: vi.fn(async () => { throw new AuthError(); }) });
    await createPopup(document, deps);
    await flush();

    document.querySelector<HTMLButtonElement>('[data-action="shorten"]')?.click();
    await flush();

    const err = document.querySelector<HTMLElement>('[data-testid="error"]');
    expect(err?.hidden).toBe(false);
    expect(err?.dataset.kind).toBe("auth");
  });

  it("shows a rate-limit state when shortening is throttled", async () => {
    const deps = makeDeps({ createLink: vi.fn(async () => { throw new RateLimitError(); }) });
    await createPopup(document, deps);
    await flush();

    document.querySelector<HTMLButtonElement>('[data-action="shorten"]')?.click();
    await flush();

    const err = document.querySelector<HTMLElement>('[data-testid="error"]');
    expect(err?.hidden).toBe(false);
    expect(err?.dataset.kind).toBe("rate-limit");
  });

  it("surfaces the retry-after delay in the rate-limit message", async () => {
    const deps = makeDeps({
      createLink: vi.fn(async () => {
        throw new RateLimitError("You're going too fast.", 30);
      }),
    });
    await createPopup(document, deps);
    await flush();

    document.querySelector<HTMLButtonElement>('[data-action="shorten"]')?.click();
    await flush();

    const err = document.querySelector<HTMLElement>('[data-testid="error"]');
    expect(err?.dataset.kind).toBe("rate-limit");
    expect(err?.textContent).toContain("30 seconds");
  });
});

describe("browserShortUrlOf", () => {
  it("uses https for a hosted domain", () => {
    const settings: Settings = { apiBaseUrl: "https://snapurl.example", apiKey: "k", defaultDomain: "snp.li" };
    const link = { domain: "snp.li", slug: "abc" } as Link;
    expect(browserShortUrlOf(settings, link)).toBe("https://snp.li/abc");
  });

  it("uses http for a self-hosted localhost domain matching the API base URL", () => {
    const settings: Settings = { apiBaseUrl: "http://localhost:3002", apiKey: "k", defaultDomain: "localhost:3002" };
    const link = { domain: "localhost:3002", slug: "abc" } as Link;
    expect(browserShortUrlOf(settings, link)).toBe("http://localhost:3002/abc");
  });
});
