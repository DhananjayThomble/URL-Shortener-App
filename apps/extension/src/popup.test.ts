import { beforeEach, describe, expect, it, vi } from "vitest";

import { Link } from "@snapurl/contract";

import { AuthError, RateLimitError, ScopeError } from "./lib/api-client.js";
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
  uniqueClicks: 2,
  sparkline: [0, 1, 0, 2, 3, 1, 0],
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

  it("shows a distinct scope-error kind when the key lacks a scope", async () => {
    const deps = makeDeps({
      createLink: vi.fn(async () => {
        throw new ScopeError("This API key is missing the \"links:write\" scope.", "links:write");
      }),
    });
    await createPopup(document, deps);
    await flush();
    document.querySelector<HTMLButtonElement>('[data-action="shorten"]')?.click();
    await flush();
    const err = document.querySelector<HTMLElement>('[data-testid="error"]');
    expect(err?.dataset.kind).toBe("scope");
    expect(err?.textContent).toContain("links:write");
  });

  it("populates the domain picker from listDomains and submits the chosen domain", async () => {
    const listDomains = vi.fn(async () => [
      { id: "d1", domain: "snp.li", status: "live", ssl: "active", links: 1, rootRedirect: null, notFoundRedirect: null },
      { id: "d2", domain: "go.acme.com", status: "live", ssl: "active", links: 0, rootRedirect: null, notFoundRedirect: null },
    ]);
    const deps = makeDeps({ listDomains } as Partial<PopupDeps>);
    await createPopup(document, deps);
    await flush();

    const select = document.querySelector<HTMLSelectElement>('[data-testid="domain-select"]');
    expect(select).not.toBeNull();
    expect(select?.options.length).toBe(2);
    // Default domain snp.li is preselected.
    expect(select?.value).toBe("snp.li");

    select!.value = "go.acme.com";
    document.querySelector<HTMLButtonElement>('[data-action="shorten"]')?.click();
    await flush();
    const [, params] = (deps.createLink as ReturnType<typeof vi.fn>).mock.calls[0]!;
    expect(params.domain).toBe("go.acme.com");
  });

  it("auto-resolves a domain from listDomains even without a default domain", async () => {
    const listDomains = vi.fn(async () => [
      { id: "d2", domain: "go.acme.com", status: "live", ssl: "active", links: 0, rootRedirect: null, notFoundRedirect: null },
    ]);
    const deps = makeDeps({
      loadSettings: vi.fn(async () => ({ ...configured, defaultDomain: undefined })),
      listDomains,
    } as Partial<PopupDeps>);
    await createPopup(document, deps);
    await flush();

    // needs-domain must NOT be shown because the picker resolved a domain.
    expect(document.querySelector<HTMLElement>('[data-testid="needs-domain"]')?.hidden).toBe(true);
    expect(document.querySelector<HTMLButtonElement>('[data-action="shorten"]')?.hidden).toBe(false);
  });

  it("rejects an invalid custom alias before submitting", async () => {
    const deps = makeDeps();
    await createPopup(document, deps);
    await flush();

    const alias = document.querySelector<HTMLInputElement>('[data-testid="alias-input"]');
    alias!.value = "bad slug!";
    document.querySelector<HTMLButtonElement>('[data-action="shorten"]')?.click();
    await flush();

    expect(document.querySelector<HTMLElement>('[data-testid="alias-error"]')?.hidden).toBe(false);
    expect(deps.createLink).not.toHaveBeenCalled();
  });

  it("passes a valid alias and UTM tags into the create body", async () => {
    const deps = makeDeps();
    await createPopup(document, deps);
    await flush();

    document.querySelector<HTMLInputElement>('[data-testid="alias-input"]')!.value = "my-link";
    document.querySelector<HTMLInputElement>('[data-testid="utm-source"]')!.value = "newsletter";
    document.querySelector<HTMLInputElement>('[data-testid="utm-medium"]')!.value = "email";
    document.querySelector<HTMLButtonElement>('[data-action="shorten"]')?.click();
    await flush();

    const [, params] = (deps.createLink as ReturnType<typeof vi.fn>).mock.calls[0]!;
    expect(params.slug).toBe("my-link");
    expect(params.utm).toEqual({ source: "newsletter", medium: "email" });
  });

  it("renders a QR panel and wires the PNG download after shortening", async () => {
    const qrPng = vi.fn(async () => "data:image/png;base64,AAA");
    const qrSvg = vi.fn(async () => "<svg></svg>");
    const download = vi.fn();
    const deps = makeDeps({ qrPng, qrSvg, download } as Partial<PopupDeps>);
    await createPopup(document, deps);
    await flush();

    document.querySelector<HTMLButtonElement>('[data-action="shorten"]')?.click();
    await flush();

    const qr = document.querySelector<HTMLElement>('[data-testid="qr"]');
    expect(qr?.hidden).toBe(false);
    const img = document.querySelector<HTMLImageElement>('[data-testid="qr-preview"]');
    expect(img?.getAttribute("src")).toBe("data:image/png;base64,AAA");

    document.querySelector<HTMLButtonElement>('[data-testid="qr-download-png"]')?.click();
    await flush();
    expect(download).toHaveBeenCalledWith(expect.stringContaining(".png"), "data:image/png;base64,AAA", "image/png");

    document.querySelector<HTMLButtonElement>('[data-testid="qr-download-svg"]')?.click();
    await flush();
    expect(download).toHaveBeenCalledWith(expect.stringContaining(".svg"), "<svg></svg>", "image/svg+xml");
  });

  it("issues a server-side search query when typing in the recent search box", async () => {
    vi.useFakeTimers();
    const deps = makeDeps();
    await createPopup(document, deps);
    await Promise.resolve();
    await Promise.resolve();

    const search = document.querySelector<HTMLInputElement>('[data-testid="recent-search"]');
    search!.value = "campaign";
    search!.dispatchEvent(new Event("input"));
    vi.advanceTimersByTime(300);
    await Promise.resolve();

    const calls = (deps.listLinks as ReturnType<typeof vi.fn>).mock.calls;
    const searched = calls.find((c) => c[1]?.search === "campaign");
    expect(searched).toBeTruthy();
    vi.useRealTimers();
  });

  it("renders per-row copy, a click badge and a sparkline for recent links", async () => {
    const deps = makeDeps();
    await createPopup(document, deps);
    await flush();

    const badge = document.querySelector<HTMLElement>('[data-testid="recent-clicks"]');
    expect(badge?.textContent).toBe("3 clicks");
    expect(document.querySelector('.recent__sparkline')).not.toBeNull();

    const copyBtn = document.querySelector<HTMLButtonElement>('[data-testid="recent-copy"]');
    expect(copyBtn).not.toBeNull();
    copyBtn?.click();
    await flush();
    expect(deps.copyToClipboard).toHaveBeenCalledWith("https://snp.li/abc");
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
