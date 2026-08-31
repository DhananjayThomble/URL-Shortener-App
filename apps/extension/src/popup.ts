/* The toolbar popup controller.
 *
 * This is the extension's whole surface. It reads the user's settings and the
 * active tab, decides which state to show (needs configuration, needs a default
 * domain, an unshortenable page, or the shorten-and-recent view), shortens the
 * active tab on demand, and lists recent links. Every effect it needs — storage,
 * the API client, the active tab URL, the clipboard, opening a tab — is injected
 * through PopupDeps so the same code runs headlessly under vitest and inside the
 * MV3 popup, where it is wired up by wirePopup() at the bottom of the file.
 */

import { createLink as apiCreateLink, listLinks as apiListLinks, AuthError, RateLimitError } from "./lib/api-client.js";
import type { CreateLinkParams } from "./lib/api-client.js";
import { hasCredentials, loadSettings as storageLoadSettings } from "./lib/storage.js";
import type { Settings } from "./lib/storage.js";
import { shortenableUrl } from "./lib/active-url.js";
import { buildShortUrl } from "./lib/short-url.js";
import type { Link, LinkList } from "@snapurl/contract";

/** Everything the controller touches, injected so it is testable without a browser. */
export interface PopupDeps {
  loadSettings: () => Promise<Settings>;
  getActiveTabUrl: () => Promise<string | undefined>;
  createLink: (settings: Settings, params: CreateLinkParams) => Promise<Link>;
  listLinks: (settings: Settings, query: { limit: number }) => Promise<LinkList>;
  copyToClipboard: (text: string) => Promise<void>;
  openUrl: (url: string) => void;
  openOptions: () => void;
  /** Build the public short URL a link resolves at. */
  shortUrlOf: (link: Link) => string;
}

/** The popup's static DOM. Kept here so popup.html and the tests share one source. */
export const POPUP_MARKUP = `
<main class="popup">
  <header class="popup__header">
    <h1 class="popup__title">SnapURL</h1>
    <button type="button" class="linkish" data-action="open-options" data-testid="settings-link">Settings</button>
  </header>

  <section data-testid="needs-config" hidden>
    <p>Set your SnapURL API base URL and API key to start shortening.</p>
    <button type="button" data-action="open-options">Open settings</button>
  </section>

  <section data-testid="not-shortenable" hidden>
    <p data-testid="not-shortenable-reason"></p>
  </section>

  <section data-testid="needs-domain" hidden>
    <p>Set a default short domain in settings to shorten links.</p>
    <button type="button" data-action="open-options">Open settings</button>
  </section>

  <section data-testid="shorten" hidden>
    <button type="button" data-action="shorten" data-testid="shorten-button" hidden>Shorten this page</button>
    <p data-testid="shorten-loading" hidden>Shortening…</p>

    <div data-testid="result" hidden>
      <a href="#" data-testid="short-url" data-action="open" target="_blank" rel="noreferrer"></a>
      <div class="popup__result-actions">
        <button type="button" data-action="copy">Copy</button>
        <button type="button" data-action="open">Open</button>
      </div>
      <span data-testid="copied" hidden>Copied</span>
    </div>

    <p class="popup__error" data-testid="error" data-kind="" hidden></p>
  </section>

  <section data-testid="recent" hidden>
    <h2 class="popup__subtitle">Recent links</h2>
    <p data-testid="recent-loading" hidden>Loading…</p>
    <p data-testid="recent-empty" hidden>No links yet.</p>
    <ul data-testid="recent-list" class="popup__list"></ul>
  </section>
</main>
`;

function show(el: HTMLElement | null, visible: boolean): void {
  if (el) el.hidden = !visible;
}

function q<T extends HTMLElement>(root: ParentNode, selector: string): T | null {
  return root.querySelector<T>(selector);
}

function errorKind(error: unknown): "auth" | "rate-limit" | "generic" {
  if (error instanceof AuthError) return "auth";
  if (error instanceof RateLimitError) return "rate-limit";
  return "generic";
}

function errorMessage(error: unknown): string {
  if (error instanceof RateLimitError && typeof error.retryAfterSeconds === "number") {
    const seconds = Math.max(1, Math.ceil(error.retryAfterSeconds));
    const unit = seconds === 1 ? "second" : "seconds";
    return `${error.message} Try again in ${seconds} ${unit}.`;
  }
  if (error instanceof Error && error.message) return error.message;
  return "Something went wrong. Try again.";
}

/**
 * Wire the popup controller to a document. Resolves once the initial render
 * (settings + active tab + recent links) has completed.
 */
export async function createPopup(doc: Document, deps: PopupDeps): Promise<void> {
  const needsConfig = q<HTMLElement>(doc, '[data-testid="needs-config"]');
  const notShortenable = q<HTMLElement>(doc, '[data-testid="not-shortenable"]');
  const notShortenableReason = q<HTMLElement>(doc, '[data-testid="not-shortenable-reason"]');
  const needsDomain = q<HTMLElement>(doc, '[data-testid="needs-domain"]');
  const shortenSection = q<HTMLElement>(doc, '[data-testid="shorten"]');
  const shortenButton = q<HTMLButtonElement>(doc, '[data-action="shorten"]');
  const shortenLoading = q<HTMLElement>(doc, '[data-testid="shorten-loading"]');
  const result = q<HTMLElement>(doc, '[data-testid="result"]');
  const shortUrlEl = q<HTMLAnchorElement>(doc, '[data-testid="short-url"]');
  const copied = q<HTMLElement>(doc, '[data-testid="copied"]');
  const errorEl = q<HTMLElement>(doc, '[data-testid="error"]');
  const recent = q<HTMLElement>(doc, '[data-testid="recent"]');
  const recentLoading = q<HTMLElement>(doc, '[data-testid="recent-loading"]');
  const recentEmpty = q<HTMLElement>(doc, '[data-testid="recent-empty"]');
  const recentList = q<HTMLUListElement>(doc, '[data-testid="recent-list"]');

  // The Settings/open-options buttons are always live.
  for (const btn of doc.querySelectorAll<HTMLButtonElement>('[data-action="open-options"]')) {
    btn.addEventListener("click", () => deps.openOptions());
  }

  const settings = await deps.loadSettings();

  if (!hasCredentials(settings)) {
    show(needsConfig, true);
    return;
  }

  const tabUrl = await deps.getActiveTabUrl();
  const shortenable = shortenableUrl(tabUrl);

  // Recent links load regardless of whether the current tab is shortenable.
  void renderRecent();

  if (!shortenable.ok) {
    if (notShortenableReason) notShortenableReason.textContent = shortenable.reason;
    show(notShortenable, true);
    return;
  }

  if (!settings.defaultDomain || !settings.defaultDomain.trim()) {
    show(needsDomain, true);
    return;
  }

  const destination = shortenable.url;
  show(shortenSection, true);
  show(shortenButton, true);

  shortenButton?.addEventListener("click", () => {
    void shorten(destination);
  });

  async function shorten(url: string): Promise<void> {
    show(errorEl, false);
    show(result, false);
    show(shortenButton, false);
    show(shortenLoading, true);
    try {
      const link = await deps.createLink(settings, { destination: url, domain: settings.defaultDomain });
      const shortUrl = deps.shortUrlOf(link);
      if (shortUrlEl) {
        shortUrlEl.textContent = shortUrl;
        shortUrlEl.href = shortUrl;
        shortUrlEl.dataset.url = shortUrl;
      }
      show(result, true);
      show(copied, false);
      // Refresh the recent list so the new link appears.
      void renderRecent();
    } catch (error) {
      if (errorEl) {
        errorEl.dataset.kind = errorKind(error);
        errorEl.textContent = errorMessage(error);
      }
      show(errorEl, true);
      show(shortenButton, true);
    } finally {
      show(shortenLoading, false);
    }
  }

  // Copy / open act on the currently rendered short URL.
  q<HTMLButtonElement>(doc, '[data-action="copy"]')?.addEventListener("click", () => {
    const url = shortUrlEl?.dataset.url;
    if (!url) return;
    void deps.copyToClipboard(url).then(() => show(copied, true));
  });
  for (const openBtn of doc.querySelectorAll<HTMLElement>('[data-action="open"]')) {
    openBtn.addEventListener("click", (event) => {
      event.preventDefault();
      const url = shortUrlEl?.dataset.url;
      if (url) deps.openUrl(url);
    });
  }

  async function renderRecent(): Promise<void> {
    show(recent, true);
    show(recentEmpty, false);
    show(recentLoading, true);
    if (recentList) recentList.textContent = "";
    try {
      const list = await deps.listLinks(settings, { limit: 5 });
      if (list.items.length === 0) {
        show(recentEmpty, true);
        return;
      }
      for (const link of list.items) {
        const li = doc.createElement("li");
        li.dataset.testid = "recent-item";
        const shortUrl = deps.shortUrlOf(link);
        const anchor = doc.createElement("a");
        anchor.textContent = shortUrl;
        anchor.href = shortUrl;
        anchor.target = "_blank";
        anchor.rel = "noreferrer";
        anchor.addEventListener("click", (event) => {
          event.preventDefault();
          deps.openUrl(shortUrl);
        });
        li.appendChild(anchor);
        recentList?.appendChild(li);
      }
    } catch (error) {
      // A recent-links failure must not hide the shorten UI; surface it inline.
      show(recentEmpty, false);
      const li = doc.createElement("li");
      li.dataset.kind = errorKind(error);
      li.textContent = errorMessage(error);
      recentList?.appendChild(li);
    } finally {
      show(recentLoading, false);
    }
  }
}

/* ---- Browser wiring (guarded on the chrome global) ---- */

/**
 * Build the public short URL for a link, deriving the scheme from the domain and
 * the configured API base URL rather than assuming https, so self-hosted http
 * domains (e.g. the default localhost:3002) resolve. Exported for testing.
 */
export function browserShortUrlOf(settings: Settings, link: Link): string {
  return buildShortUrl(link, { apiBaseUrl: settings.apiBaseUrl });
}

async function activeTabUrl(): Promise<string | undefined> {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  return tab?.url;
}

function browserDeps(settings: Settings): PopupDeps {
  return {
    loadSettings: async () => settings,
    getActiveTabUrl: activeTabUrl,
    createLink: (currentSettings, params) => apiCreateLink(currentSettings, params),
    listLinks: (currentSettings, query) => apiListLinks(currentSettings, query),
    copyToClipboard: (text) => navigator.clipboard.writeText(text),
    openUrl: (url) => {
      void chrome.tabs.create({ url });
    },
    openOptions: () => {
      if (chrome.runtime.openOptionsPage) void chrome.runtime.openOptionsPage();
    },
    shortUrlOf: (link) => browserShortUrlOf(settings, link),
  };
}

if (typeof chrome !== "undefined" && chrome.tabs && typeof document !== "undefined") {
  document.addEventListener("DOMContentLoaded", () => {
    const root = document.querySelector('[data-app="popup"]') ?? document.body;
    root.innerHTML = POPUP_MARKUP;
    void storageLoadSettings().then((settings) => createPopup(document, browserDeps(settings)));
  });
}
