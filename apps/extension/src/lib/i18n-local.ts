/* i18n for the Track-C surfaces (options + onboarding).
 *
 * SPEC §5.1 makes `src/lib/i18n.ts` + `_locales/en/messages.json` the shared
 * foundation OWNED BY TRACK B. To keep this worktree building standalone and to
 * never touch Track B's files, Track C ships its own self-contained message
 * catalog and `t()` here. At Round-3 integration these keys fold into the shared
 * `_locales/en/messages.json` (append-only, alphabetized) and the two helpers
 * collapse into one — until then this stays independent so the tracks merge
 * without a create/create conflict on the shared files.
 *
 * `t()` prefers `chrome.i18n.getMessage` (so a real locale bundle wins once it
 * exists) and falls back to the in-module English catalog, which is also what
 * the DOM tests assert against (no chrome global under happy-dom).
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

/**
 * Resolve a message. Prefers chrome.i18n.getMessage(key) when a locale bundle
 * is present (returns a non-empty string), otherwise the in-module English
 * catalog. Unknown keys return the key itself so a missing string is visible in
 * a test rather than silently blank.
 */
export function t(key: OptionsMessageKey): string {
  const i18n = globalThis.chrome?.i18n;
  if (i18n && typeof i18n.getMessage === "function") {
    const fromBundle = i18n.getMessage(key);
    if (fromBundle) return fromBundle;
  }
  return OPTIONS_MESSAGES[key] ?? key;
}
