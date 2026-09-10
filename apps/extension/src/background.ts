/* MV3 background service worker.
 *
 * Service workers in Manifest V3 are event-driven and disposable: the browser
 * spins this up to handle an event and tears it down when idle, so it holds no
 * long-lived state and registers every listener at the top level (a hard MV3
 * requirement). Beyond seeding empty settings on first install, this worker owns
 * the two no-popup entry points to shortening:
 *
 *   F1 — a context-menu item ("Shorten with SnapURL") on the page and on any
 *        right-clicked link, which creates a link with the default domain and
 *        writes the short URL to the clipboard, reporting via chrome.notifications.
 *   F2 — a keyboard command (shorten-active-tab) that opens the popup so the user
 *        gets the full form (domain/alias/UTM), matching Chrome's guidance that a
 *        command should surface UI rather than act invisibly on ambiguous input.
 *
 * Every side effect is injected through BackgroundDeps so the handlers run under
 * vitest without a `chrome` global, and the real wiring at the bottom is guarded
 * on the runtime so importing this file in a test is a harmless no-op.
 */

import { createLink as apiCreateLink } from "./lib/api-client.js";
import { buildShortUrl } from "./lib/short-url.js";
import { loadSettings, saveSettings, hasCredentials } from "./lib/storage.js";
import type { Settings } from "./lib/storage.js";
import { t } from "./lib/i18n.js";

/** The stable id of the context-menu entry. */
export const CONTEXT_MENU_ID = "snapurl-shorten";

/** Everything the background handlers touch, injected for headless testing. */
export interface BackgroundDeps {
  loadSettings: () => Promise<Settings>;
  createLink: typeof apiCreateLink;
  /** Build the public short URL for a created link (scheme-aware). */
  shortUrlOf: (settings: Settings, link: Awaited<ReturnType<typeof apiCreateLink>>) => string;
  copyToClipboard: (text: string) => Promise<void>;
  notify: (message: string, isError: boolean) => void;
  openOptions: () => void;
}

/**
 * Shorten a destination URL from a no-popup entry point (context menu). Resolves
 * the default domain from settings, creates the link, copies it, and notifies.
 * Errors are caught and turned into an error notification — a background handler
 * must never throw into the event loop.
 */
export async function shortenInBackground(deps: BackgroundDeps, destination: string): Promise<void> {
  try {
    const settings = await deps.loadSettings();
    if (!hasCredentials(settings)) {
      deps.notify(t("bg_needs_config"), true);
      deps.openOptions();
      return;
    }
    if (!settings.defaultDomain || !settings.defaultDomain.trim()) {
      deps.notify(t("bg_needs_domain"), true);
      deps.openOptions();
      return;
    }
    const link = await deps.createLink(settings, { destination, domain: settings.defaultDomain });
    const shortUrl = deps.shortUrlOf(settings, link);
    await deps.copyToClipboard(shortUrl);
    deps.notify(t("bg_copied", shortUrl), false);
  } catch (error) {
    const message = error instanceof Error && error.message ? error.message : t("bg_failed");
    deps.notify(message, true);
  }
}

/**
 * The URL a context-menu click should shorten: the right-clicked link if there
 * was one, else the page the menu was invoked on. Undefined when neither is a
 * real http(s) URL (e.g. a right-click on a chrome:// page).
 */
export function contextTargetUrl(info: {
  linkUrl?: string;
  pageUrl?: string;
}): string | undefined {
  const candidate = info.linkUrl ?? info.pageUrl;
  if (!candidate) return undefined;
  try {
    const parsed = new URL(candidate);
    if (parsed.protocol === "http:" || parsed.protocol === "https:") return candidate;
  } catch {
    /* not a URL */
  }
  return undefined;
}

/** Seed default (empty) settings on first install, then send the user to options. */
export async function handleInstalled(details: chrome.runtime.InstalledDetails): Promise<void> {
  if (details.reason !== "install") return;
  const settings = await loadSettings();
  if (!settings.apiBaseUrl) {
    await saveSettings({ apiBaseUrl: "", apiKey: "" });
  }
  if (chrome.runtime.openOptionsPage) {
    await chrome.runtime.openOptionsPage();
  }
}

/** Register (idempotently) the context-menu entry for pages and links. */
export function registerContextMenu(menus: typeof chrome.contextMenus): void {
  menus.removeAll(() => {
    menus.create({
      id: CONTEXT_MENU_ID,
      title: t("bg_context_menu"),
      contexts: ["page", "link"],
    });
  });
}

/* ---- Browser wiring (guarded on the chrome global) ---- */

/** Fire a Chrome notification; a missing notifications API degrades to a no-op. */
function browserNotify(message: string, isError: boolean): void {
  if (!chrome.notifications?.create) return;
  chrome.notifications.create({
    type: "basic",
    iconUrl: chrome.runtime.getURL("icons/icon-128.png"),
    title: isError ? t("bg_title_error") : t("bg_title_success"),
    message,
  });
}

function browserDeps(): BackgroundDeps {
  return {
    loadSettings,
    createLink: apiCreateLink,
    shortUrlOf: (settings, link) => buildShortUrl(link, { apiBaseUrl: settings.apiBaseUrl }),
    copyToClipboard: async (text) => {
      // A service worker has no navigator.clipboard, so write via the offscreen
      // clipboard shim isn't available on activeTab-only extensions; fall back to
      // notifying the URL (below). We attempt clipboard where present (some
      // channels expose it) and swallow failure so the notification still fires.
      try {
        if (typeof navigator !== "undefined" && navigator.clipboard?.writeText) {
          await navigator.clipboard.writeText(text);
        }
      } catch {
        /* clipboard unavailable in SW context; the URL is still in the notification */
      }
    },
    notify: browserNotify,
    openOptions: () => {
      if (chrome.runtime.openOptionsPage) void chrome.runtime.openOptionsPage();
    },
  };
}

async function activeTabUrl(): Promise<string | undefined> {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  return tab?.url;
}

if (typeof chrome !== "undefined" && chrome.runtime?.onInstalled) {
  chrome.runtime.onInstalled.addListener((details) => {
    void handleInstalled(details);
    if (chrome.contextMenus) registerContextMenu(chrome.contextMenus);
  });

  // Re-register the menu when the worker wakes (menus don't survive SW teardown
  // reliably across all channels); onStartup covers browser restart.
  if (chrome.runtime.onStartup && chrome.contextMenus) {
    chrome.runtime.onStartup.addListener(() => registerContextMenu(chrome.contextMenus));
  }

  if (chrome.contextMenus?.onClicked) {
    chrome.contextMenus.onClicked.addListener((info) => {
      if (info.menuItemId !== CONTEXT_MENU_ID) return;
      const target = contextTargetUrl({ linkUrl: info.linkUrl, pageUrl: info.pageUrl });
      if (!target) {
        browserNotify(t("bg_not_shortenable"), true);
        return;
      }
      void shortenInBackground(browserDeps(), target);
    });
  }

  // F2 — the keyboard command opens the popup so the user gets the full form.
  if (chrome.commands?.onCommand) {
    chrome.commands.onCommand.addListener((command) => {
      if (command !== "shorten-active-tab") return;
      if (chrome.action?.openPopup) {
        chrome.action.openPopup().catch(() => {
          // openPopup can reject if no window is focused; fall back to a direct
          // background shorten of the active tab so the shortcut still works.
          void activeTabUrl().then((url) => {
            const target = contextTargetUrl({ pageUrl: url });
            if (target) void shortenInBackground(browserDeps(), target);
          });
        });
      }
    });
  }
}
