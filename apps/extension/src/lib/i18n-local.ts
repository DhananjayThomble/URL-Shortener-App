/* Options/onboarding English fallback catalog (Track C strings).
 *
 * Round-3 i18n reconciliation (SPEC §5.1): the shared i18n mechanism is
 * `src/lib/i18n.ts` (owned by Track B) reading `_locales/en/messages.json` via
 * chrome.i18n. Track C's strings have been folded into that shared catalog.
 *
 * This module no longer defines its own `t()`. It keeps ONLY the plain
 * key→string map so `options.ts` can register it via `setFallbackMessages()`
 * for non-browser (vitest/happy-dom) contexts, where `chrome.i18n` is absent.
 * The keys here mirror the options/onboarding entries in
 * `_locales/en/messages.json` exactly — keep them in sync when either changes.
 */

/** English strings for every user-facing options/onboarding label. */
export const OPTIONS_MESSAGES = {
  optionsTitle: "SnapURL settings",
  optionsIntro:
    "Point the extension at your SnapURL API and paste a scoped API key.",

  sectionConnection: "Connection",
  sectionDefaults: "Defaults",
  sectionShortcuts: "Shortcuts",
  sectionCors: "This extension's origin",

  labelApiBaseUrl: "API base URL",
  labelApiKey: "API key",
  labelDefaultDomain: "Default short domain",

  hintApiKeyScopes:
    "A snap_live_… key with the links:read and links:write scopes (domains:read for the domain picker, analytics:read is optional).",
  hintDefaultDomain:
    "New links are created under this domain. Required — the API rejects a create with an empty domain.",

  showKey: "Show",
  hideKey: "Hide",

  testConnection: "Test connection",
  testing: "Testing…",
  verdictOk: "Connected. Your key works and can reach the API.",
  verdictAuth: "Your API key was rejected (401/403). Check the key and its scopes.",
  verdictNetwork:
    "Couldn't reach the API. If this is a production API, add this extension's origin (below) to EXTENSION_ORIGINS and restart it.",
  verdictGeneric: "The API responded with an error. See the message above.",
  verdictNeedsConfig: "Enter an API base URL and key first.",

  save: "Save",
  saved: "Settings saved.",

  shortcutsIntro: "Change the keyboard shortcut at chrome://extensions/shortcuts.",
  openShortcuts: "Open shortcuts settings",

  corsIntro:
    "In production the API's CORS is origin-restricted. Add this extension's origin to the API's EXTENSION_ORIGINS allowlist (comma-separated) and restart the API. In development any origin is reflected, so this only matters in production.",
  corsIdLabel: "Extension origin",
  corsEnvLabel: ".env line to add",
  copy: "Copy",
  copied: "Copied",

  onboardingTitle: "Set up SnapURL",
  stepApiUrlTitle: "1. Your SnapURL API",
  stepApiUrlBody: "Enter the origin of your SnapURL API — no trailing /api/v1.",
  stepApiKeyTitle: "2. Your API key",
  stepApiKeyBody:
    "Paste a snap_live_… key from the dashboard Developers page. It needs links:read and links:write; domains:read for the domain picker.",
  stepCorsTitle: "3. Allow this extension & test",
  stepCorsBody:
    "Add the origin below to your API's EXTENSION_ORIGINS, restart the API, then test the connection. A green result finishes setup.",
  next: "Next",
  back: "Back",
  finish: "Finish",
  onboardingDone: "You're all set. This extension is ready to shorten links.",
} as const;

export type OptionsMessageKey = keyof typeof OPTIONS_MESSAGES;
