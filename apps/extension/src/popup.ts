/* The toolbar popup controller.
 *
 * This is the extension's whole surface. It reads the user's settings and the
 * active tab, decides which state to show (needs configuration, needs a default
 * domain, an unshortenable page, or the shorten-and-recent view), shortens the
 * active tab on demand — with an optional domain picker, custom alias, and UTM
 * tags — renders a QR code of the result with PNG/SVG download, and lists recent
 * links with server-side search, per-row copy, a click badge and an inline
 * sparkline. Every effect it needs — storage, the API client, the active tab
 * URL, the clipboard, opening a tab, listing domains, generating a QR, triggering
 * a download — is injected through PopupDeps so the same code runs headlessly
 * under vitest and inside the MV3 popup, where it is wired up by the guarded
 * block at the bottom of the file.
 */

import {
  createLink as apiCreateLink,
  listLinks as apiListLinks,
  listDomains as apiListDomains,
  AuthError,
  RateLimitError,
  ScopeError,
  NetworkError,
} from "./lib/api-client.js";
import type { CreateLinkParams } from "./lib/api-client.js";
import { hasCredentials, loadSettings as storageLoadSettings } from "./lib/storage.js";
import type { Settings } from "./lib/storage.js";
import { shortenableUrl } from "./lib/active-url.js";
import { buildShortUrl } from "./lib/short-url.js";
import { buildUtm } from "./lib/utm.js";
import { toPngDataUrl, toSvgString, qrFilenameStem } from "./lib/qr.js";
import { t } from "./lib/i18n.js";
import type { Domain, Link, LinkList } from "@snapurl/contract";

/** Everything the controller touches, injected so it is testable without a browser. */
export interface PopupDeps {
  loadSettings: () => Promise<Settings>;
  getActiveTabUrl: () => Promise<string | undefined>;
  getActiveTabTitle?: () => Promise<string | undefined>;
  createLink: (settings: Settings, params: CreateLinkParams) => Promise<Link>;
  listLinks: (settings: Settings, query: { limit: number; search?: string }) => Promise<LinkList>;
  /** List the workspace's domains for the picker (F4). Optional — absent = no picker. */
  listDomains?: (settings: Settings) => Promise<Domain[]>;
  copyToClipboard: (text: string) => Promise<void>;
  openUrl: (url: string) => void;
  openOptions: () => void;
  /** Build the public short URL a link resolves at. */
  shortUrlOf: (link: Link) => string;
  /** Generate a QR PNG data URL for a short URL (F6). Optional — absent = no QR. */
  qrPng?: (text: string) => Promise<string>;
  /** Generate a QR SVG string for a short URL (F6). */
  qrSvg?: (text: string) => Promise<string>;
  /** Trigger a client-side download of the given content (F6). */
  download?: (filename: string, dataUrlOrText: string, mime: string) => void;
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

  <section data-testid="shorten" class="popup__form" hidden>
    <p class="field" data-testid="active-page" hidden>
      <span class="field__label" data-testid="active-page-title"></span>
      <span class="linkish" data-testid="active-page-url"></span>
    </p>

    <label class="field" data-testid="domain-field" hidden>
      <span class="field__label">Domain</span>
      <select class="field__input domain-select" data-testid="domain-select" aria-label="Short domain"></select>
    </label>

    <label class="field">
      <span class="field__label">Custom alias (optional)</span>
      <input class="field__input alias-input" type="text" data-testid="alias-input"
             placeholder="auto" aria-label="Custom alias" autocomplete="off" spellcheck="false" />
      <span class="field__error" data-testid="alias-error" role="alert" hidden></span>
    </label>

    <details class="utm-disclosure" data-testid="utm-disclosure">
      <summary>Add campaign tags (UTM)</summary>
      <div class="utm-grid">
        <label class="field"><span class="field__label">Source</span>
          <input class="field__input" type="text" data-testid="utm-source" aria-label="UTM source" autocomplete="off" /></label>
        <label class="field"><span class="field__label">Medium</span>
          <input class="field__input" type="text" data-testid="utm-medium" aria-label="UTM medium" autocomplete="off" /></label>
        <label class="field"><span class="field__label">Campaign</span>
          <input class="field__input" type="text" data-testid="utm-campaign" aria-label="UTM campaign" autocomplete="off" /></label>
        <label class="field"><span class="field__label">Content</span>
          <input class="field__input" type="text" data-testid="utm-content" aria-label="UTM content" autocomplete="off" /></label>
      </div>
    </details>

    <button type="button" class="btn btn--primary" data-action="shorten" data-testid="shorten-button" hidden>Shorten this page</button>
    <p data-testid="shorten-loading" hidden>Shortening…</p>

    <div class="result" data-testid="result" hidden>
      <a href="#" class="result__url" data-testid="short-url" data-action="open" target="_blank" rel="noreferrer"></a>
      <div class="result__actions popup__result-actions">
        <button type="button" class="btn btn--ghost" data-action="copy">Copy</button>
        <button type="button" class="btn btn--ghost" data-action="open">Open</button>
        <button type="button" class="btn btn--ghost" data-action="shorten-another" data-testid="shorten-another">Shorten another</button>
      </div>
      <span data-testid="copied" hidden>Copied</span>
      <div class="qr" data-testid="qr" hidden>
        <img class="qr__preview" data-testid="qr-preview" alt="QR code for the short link" width="128" height="128" />
        <div class="qr__actions">
          <button type="button" class="btn btn--ghost" data-action="qr-png" data-testid="qr-download-png">Download PNG</button>
          <button type="button" class="btn btn--ghost" data-action="qr-svg" data-testid="qr-download-svg">Download SVG</button>
        </div>
      </div>
    </div>

    <p class="popup__error error" data-testid="error" data-kind="" role="alert" hidden></p>
  </section>

  <section data-testid="recent" class="recent" hidden>
    <h2 class="popup__subtitle">Recent links in this workspace</h2>
    <input class="recent__search" type="search" data-testid="recent-search"
           placeholder="Search links…" aria-label="Search recent links" autocomplete="off" />
    <p data-testid="recent-loading" hidden>Loading…</p>
    <p data-testid="recent-empty" hidden>No links yet.</p>
    <ul data-testid="recent-list" class="recent__list popup__list"></ul>
  </section>
</main>
`;

function show(el: HTMLElement | null, visible: boolean): void {
  if (el) el.hidden = !visible;
}

function q<T extends HTMLElement>(root: ParentNode, selector: string): T | null {
  return root.querySelector<T>(selector);
}

/** Slug regex mirrors CreateLinkInput.slug (`/^[a-zA-Z0-9._-]*$/` or empty). */
const SLUG_RE = /^[a-zA-Z0-9._-]*$/;

function errorKind(error: unknown): "auth" | "scope" | "rate-limit" | "offline" | "generic" {
  if (error instanceof ScopeError) return "scope";
  if (error instanceof AuthError) return "auth";
  if (error instanceof RateLimitError) return "rate-limit";
  if (error instanceof NetworkError) return "offline";
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

/** Render a tiny inline SVG sparkline from a link's 30-point series (F9). */
function renderSparkline(doc: Document, series: number[]): SVGSVGElement {
  const w = 60;
  const h = 16;
  const svg = doc.createElementNS("http://www.w3.org/2000/svg", "svg");
  svg.setAttribute("viewBox", `0 0 ${w} ${h}`);
  svg.setAttribute("width", String(w));
  svg.setAttribute("height", String(h));
  svg.setAttribute("aria-hidden", "true");
  svg.classList.add("recent__sparkline");
  const points = series.length > 0 ? series : [0];
  const max = Math.max(1, ...points);
  const step = points.length > 1 ? w / (points.length - 1) : w;
  const d = points
    .map((v, i) => `${i === 0 ? "M" : "L"}${(i * step).toFixed(1)},${(h - (v / max) * h).toFixed(1)}`)
    .join(" ");
  const path = doc.createElementNS("http://www.w3.org/2000/svg", "path");
  path.setAttribute("d", d);
  path.setAttribute("fill", "none");
  path.setAttribute("stroke", "currentColor");
  path.setAttribute("stroke-width", "1");
  svg.appendChild(path);
  return svg;
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
  const recentSearch = q<HTMLInputElement>(doc, '[data-testid="recent-search"]');

  const activePage = q<HTMLElement>(doc, '[data-testid="active-page"]');
  const activePageTitle = q<HTMLElement>(doc, '[data-testid="active-page-title"]');
  const activePageUrl = q<HTMLElement>(doc, '[data-testid="active-page-url"]');
  const domainField = q<HTMLElement>(doc, '[data-testid="domain-field"]');
  const domainSelect = q<HTMLSelectElement>(doc, '[data-testid="domain-select"]');
  const aliasInput = q<HTMLInputElement>(doc, '[data-testid="alias-input"]');
  const aliasError = q<HTMLElement>(doc, '[data-testid="alias-error"]');
  const qrPanel = q<HTMLElement>(doc, '[data-testid="qr"]');
  const qrPreview = q<HTMLImageElement>(doc, '[data-testid="qr-preview"]');

  const utmField = (name: string) => q<HTMLInputElement>(doc, `[data-testid="utm-${name}"]`);

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

  // The domain picker (F4) auto-resolves a domain even when no default is set, so
  // gate needs-domain only after attempting to load domains.
  const domains = await loadDomains();
  const hasDefault = Boolean(settings.defaultDomain && settings.defaultDomain.trim());
  if (!hasDefault && domains.length === 0) {
    show(needsDomain, true);
    return;
  }

  const destination = shortenable.url;
  show(shortenSection, true);
  show(shortenButton, true);

  // Show the active page context.
  if (activePage) {
    show(activePage, true);
    if (activePageUrl) activePageUrl.textContent = destination;
    if (activePageTitle && deps.getActiveTabTitle) {
      void deps.getActiveTabTitle().then((title) => {
        if (title && activePageTitle) activePageTitle.textContent = title;
      });
    }
  }

  // Populate the domain picker; default = settings.defaultDomain else first domain.
  if (domainSelect && domains.length > 0) {
    show(domainField, true);
    domainSelect.textContent = "";
    for (const d of domains) {
      const opt = doc.createElement("option");
      opt.value = d.domain;
      opt.textContent = d.domain;
      domainSelect.appendChild(opt);
    }
    const preselect = hasDefault && domains.some((d) => d.domain === settings.defaultDomain)
      ? settings.defaultDomain!
      : domains[0]!.domain;
    domainSelect.value = preselect;
  }

  // Live alias validation.
  aliasInput?.addEventListener("input", () => {
    const value = aliasInput.value.trim();
    if (value && !SLUG_RE.test(value)) {
      if (aliasError) aliasError.textContent = "Use only letters, numbers, dot, dash or underscore.";
      show(aliasError, true);
    } else {
      show(aliasError, false);
    }
  });

  shortenButton?.addEventListener("click", () => {
    void shorten(destination);
  });

  q<HTMLButtonElement>(doc, '[data-action="shorten-another"]')?.addEventListener("click", () => {
    show(result, false);
    show(qrPanel, false);
    show(copied, false);
    show(shortenButton, true);
  });

  /** Resolve the domain to submit with: the picker value if shown, else default. */
  function resolveDomain(): string {
    if (domainSelect && !domainField?.hidden && domainSelect.value) return domainSelect.value;
    return settings.defaultDomain ?? "";
  }

  async function loadDomains(): Promise<Domain[]> {
    if (!deps.listDomains) return [];
    try {
      return await deps.listDomains(settings);
    } catch {
      // Missing scope / network — degrade silently to the default-domain path.
      return [];
    }
  }

  async function shorten(url: string): Promise<void> {
    const alias = aliasInput?.value.trim() ?? "";
    if (alias && !SLUG_RE.test(alias)) {
      if (aliasError) aliasError.textContent = "Use only letters, numbers, dot, dash or underscore.";
      show(aliasError, true);
      return;
    }
    show(errorEl, false);
    show(result, false);
    show(qrPanel, false);
    show(shortenButton, false);
    show(shortenLoading, true);
    const utm = buildUtm({
      source: utmField("source")?.value,
      medium: utmField("medium")?.value,
      campaign: utmField("campaign")?.value,
      content: utmField("content")?.value,
    });
    try {
      const link = await deps.createLink(settings, {
        destination: url,
        domain: resolveDomain(),
        ...(alias ? { slug: alias } : {}),
        ...(utm ? { utm } : {}),
      });
      const shortUrl = deps.shortUrlOf(link);
      if (shortUrlEl) {
        shortUrlEl.textContent = shortUrl;
        shortUrlEl.href = shortUrl;
        shortUrlEl.dataset.url = shortUrl;
      }
      show(result, true);
      show(copied, false);
      void renderQr(shortUrl);
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

  async function renderQr(shortUrl: string): Promise<void> {
    if (!deps.qrPng || !qrPanel || !qrPreview) return;
    try {
      const png = await deps.qrPng(shortUrl);
      qrPreview.src = png;
      qrPreview.dataset.url = shortUrl;
      show(qrPanel, true);
    } catch {
      show(qrPanel, false);
    }
  }

  // QR downloads act on the currently rendered short URL.
  q<HTMLButtonElement>(doc, '[data-action="qr-png"]')?.addEventListener("click", () => {
    const url = shortUrlEl?.dataset.url;
    if (!url || !deps.qrPng || !deps.download) return;
    void deps.qrPng(url).then((png) => deps.download!(`${qrFilenameStem(url)}.png`, png, "image/png"));
  });
  q<HTMLButtonElement>(doc, '[data-action="qr-svg"]')?.addEventListener("click", () => {
    const url = shortUrlEl?.dataset.url;
    if (!url || !deps.qrSvg || !deps.download) return;
    void deps.qrSvg(url).then((svg) => deps.download!(`${qrFilenameStem(url)}.svg`, svg, "image/svg+xml"));
  });

  // Copy / open act on the currently rendered short URL.
  q<HTMLButtonElement>(doc, '[data-action="copy"]')?.addEventListener("click", () => {
    const url = shortUrlEl?.dataset.url;
    if (!url) return;
    void deps.copyToClipboard(url).then(() => show(copied, true));
  });
  for (const openBtn of doc.querySelectorAll<HTMLElement>('.result [data-action="open"]')) {
    openBtn.addEventListener("click", (event) => {
      event.preventDefault();
      const url = shortUrlEl?.dataset.url;
      if (url) deps.openUrl(url);
    });
  }

  // Debounced server-side recent search (F7).
  let searchTimer: ReturnType<typeof setTimeout> | undefined;
  recentSearch?.addEventListener("input", () => {
    if (searchTimer) clearTimeout(searchTimer);
    searchTimer = setTimeout(() => {
      void renderRecent(recentSearch.value.trim());
    }, 250);
  });

  async function renderRecent(search?: string): Promise<void> {
    show(recent, true);
    show(recentEmpty, false);
    show(recentLoading, true);
    if (recentList) recentList.textContent = "";
    try {
      const query = { limit: 5, ...(search ? { search } : {}) };
      const list = await deps.listLinks(settings, query);
      if (list.items.length === 0) {
        show(recentEmpty, true);
        return;
      }
      for (const link of list.items) {
        recentList?.appendChild(renderRecentRow(link));
      }
    } catch (error) {
      show(recentEmpty, false);
      const li = doc.createElement("li");
      li.dataset.kind = errorKind(error);
      li.textContent = errorMessage(error);
      recentList?.appendChild(li);
    } finally {
      show(recentLoading, false);
    }
  }

  function renderRecentRow(link: Link): HTMLLIElement {
    const li = doc.createElement("li");
    li.dataset.testid = "recent-item";
    li.classList.add("recent__item");
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

    // Click badge (F8).
    const badge = doc.createElement("span");
    badge.classList.add("recent__clicks");
    badge.dataset.testid = "recent-clicks";
    const clicks = link.clicks ?? 0;
    badge.textContent = `${clicks} ${clicks === 1 ? "click" : "clicks"}`;
    li.appendChild(badge);

    // Inline sparkline (F9) — zero-cost, from Link.sparkline already on the row.
    if (Array.isArray(link.sparkline) && link.sparkline.length > 0) {
      li.appendChild(renderSparkline(doc, link.sparkline));
    }

    // Per-row copy (F8).
    const copyBtn = doc.createElement("button");
    copyBtn.type = "button";
    copyBtn.classList.add("btn", "btn--ghost");
    copyBtn.dataset.testid = "recent-copy";
    copyBtn.setAttribute("aria-label", `Copy ${shortUrl}`);
    copyBtn.textContent = "Copy";
    copyBtn.addEventListener("click", () => {
      void deps.copyToClipboard(shortUrl).then(() => {
        copyBtn.textContent = "Copied";
      });
    });
    li.appendChild(copyBtn);

    return li;
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

async function activeTab(): Promise<chrome.tabs.Tab | undefined> {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  return tab;
}

/** Trigger a browser download of arbitrary content via a transient anchor. */
function browserDownload(filename: string, dataUrlOrText: string, mime: string): void {
  const href = dataUrlOrText.startsWith("data:")
    ? dataUrlOrText
    : `data:${mime};charset=utf-8,${encodeURIComponent(dataUrlOrText)}`;
  const a = document.createElement("a");
  a.href = href;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
}

function browserDeps(settings: Settings): PopupDeps {
  return {
    loadSettings: async () => settings,
    getActiveTabUrl: async () => (await activeTab())?.url,
    getActiveTabTitle: async () => (await activeTab())?.title,
    createLink: (currentSettings, params) => apiCreateLink(currentSettings, params),
    listLinks: (currentSettings, query) => apiListLinks(currentSettings, query),
    listDomains: (currentSettings) => apiListDomains(currentSettings),
    copyToClipboard: (text) => navigator.clipboard.writeText(text),
    openUrl: (url) => {
      void chrome.tabs.create({ url });
    },
    openOptions: () => {
      if (chrome.runtime.openOptionsPage) void chrome.runtime.openOptionsPage();
    },
    shortUrlOf: (link) => browserShortUrlOf(settings, link),
    qrPng: (text) => toPngDataUrl(text),
    qrSvg: (text) => toSvgString(text),
    download: browserDownload,
  };
}

if (typeof chrome !== "undefined" && chrome.tabs && typeof document !== "undefined") {
  document.addEventListener("DOMContentLoaded", () => {
    const root = document.querySelector('[data-app="popup"]') ?? document.body;
    root.innerHTML = POPUP_MARKUP;
    void storageLoadSettings().then((settings) => createPopup(document, browserDeps(settings)));
  });
}
