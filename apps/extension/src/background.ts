/* MV3 background service worker.
 *
 * Service workers in Manifest V3 are event-driven and disposable: the browser
 * spins this up to handle an event and tears it down when idle, so it holds no
 * long-lived state. It only registers listeners at the top level (a hard MV3
 * requirement) and does the least it can: seed empty settings on first install
 * so the options page has something to read, and open that options page when a
 * fresh install has nothing configured yet.
 *
 * Every side effect is guarded behind a feature check so this module can be
 * imported in a plain Node/vitest context without a `chrome` global throwing.
 */

import { loadSettings, saveSettings } from "./lib/storage.js";

/** Seed default (empty) settings on first install, then send the user to options. */
async function handleInstalled(details: chrome.runtime.InstalledDetails): Promise<void> {
  if (details.reason !== "install") return;
  const settings = await loadSettings();
  if (!settings.apiBaseUrl) {
    await saveSettings({ apiBaseUrl: "", apiKey: "" });
  }
  // First run has no credentials — take the user straight to configuration.
  if (chrome.runtime.openOptionsPage) {
    await chrome.runtime.openOptionsPage();
  }
}

// Register listeners only when running inside the extension runtime. In tests
// there is no chrome.runtime, so importing this file is a harmless no-op.
if (typeof chrome !== "undefined" && chrome.runtime?.onInstalled) {
  chrome.runtime.onInstalled.addListener((details) => {
    void handleInstalled(details);
  });
}

export { handleInstalled };
