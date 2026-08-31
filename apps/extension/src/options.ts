/* The options page controller.
 *
 * This is where the user points the extension at their own SnapURL API and
 * pastes a scoped API key, plus an optional default short domain the popup uses
 * when creating links. It loads the current settings, validates the API base
 * URL is an absolute http(s) URL, persists everything to chrome.storage.local,
 * and shows a saved confirmation. Storage is injected so the round trip is
 * testable without the chrome runtime; wireOptions() binds the browser
 * implementation at the bottom of the file.
 */

import { loadSettings as storageLoadSettings, normalizeApiBaseUrl, saveSettings as storageSaveSettings } from "./lib/storage.js";
import type { Settings } from "./lib/storage.js";

/** Injected effects, so the controller runs headlessly under vitest. */
export interface OptionsDeps {
  loadSettings: () => Promise<Settings>;
  saveSettings: (settings: Settings) => Promise<Settings>;
}

/** The options page's static DOM, shared by options.html and the tests. */
export const OPTIONS_MARKUP = `
<main class="options">
  <h1 class="options__title">SnapURL settings</h1>
  <p class="options__intro">
    Point the extension at your SnapURL API and paste a scoped API key
    (<code>snap_live_…</code>) with the <code>links:read</code> and
    <code>links:write</code> scopes.
  </p>

  <form data-testid="options-form" class="options__form" novalidate>
    <label class="options__label" for="apiBaseUrl">API base URL</label>
    <input id="apiBaseUrl" data-field="apiBaseUrl" type="url" placeholder="https://your-host" autocomplete="off" />

    <label class="options__label" for="apiKey">API key</label>
    <input id="apiKey" data-field="apiKey" type="password" placeholder="snap_live_…" autocomplete="off" />

    <label class="options__label" for="defaultDomain">Default short domain</label>
    <input id="defaultDomain" data-field="defaultDomain" type="text" placeholder="go.example" autocomplete="off" />

    <button type="submit" data-action="save">Save</button>
  </form>

  <p class="options__saved" data-testid="saved" hidden>Settings saved.</p>
  <p class="options__error" data-testid="options-error" hidden></p>
</main>
`;

function show(el: HTMLElement | null, visible: boolean): void {
  if (el) el.hidden = !visible;
}

function field(doc: Document, name: string): HTMLInputElement | null {
  return doc.querySelector<HTMLInputElement>(`[data-field="${name}"]`);
}

/**
 * Wire the options controller to a document. Resolves once the current
 * settings have been loaded into the form.
 */
export async function createOptions(doc: Document, deps: OptionsDeps): Promise<void> {
  const form = doc.querySelector<HTMLFormElement>('[data-testid="options-form"]');
  const apiBaseUrl = field(doc, "apiBaseUrl");
  const apiKey = field(doc, "apiKey");
  const defaultDomain = field(doc, "defaultDomain");
  const saved = doc.querySelector<HTMLElement>('[data-testid="saved"]');
  const error = doc.querySelector<HTMLElement>('[data-testid="options-error"]');

  const settings = await deps.loadSettings();
  if (apiBaseUrl) apiBaseUrl.value = settings.apiBaseUrl;
  if (apiKey) apiKey.value = settings.apiKey;
  if (defaultDomain) defaultDomain.value = settings.defaultDomain ?? "";

  form?.addEventListener("submit", (event) => {
    event.preventDefault();
    void save();
  });

  async function save(): Promise<void> {
    show(saved, false);
    show(error, false);

    const rawBaseUrl = apiBaseUrl?.value ?? "";
    try {
      // Throws on empty or non-http(s); we only need it to validate here.
      normalizeApiBaseUrl(rawBaseUrl);
    } catch (validationError) {
      if (error) error.textContent = validationError instanceof Error ? validationError.message : "Invalid API base URL.";
      show(error, true);
      return;
    }

    const domain = defaultDomain?.value.trim() ?? "";
    const next: Settings = {
      apiBaseUrl: rawBaseUrl,
      apiKey: apiKey?.value ?? "",
      ...(domain ? { defaultDomain: domain } : {}),
    };

    try {
      await deps.saveSettings(next);
      show(saved, true);
    } catch (saveError) {
      if (error) error.textContent = saveError instanceof Error ? saveError.message : "Could not save settings.";
      show(error, true);
    }
  }
}

/* ---- Browser wiring (guarded on the chrome global; not run in tests) ---- */

if (typeof chrome !== "undefined" && chrome.storage && typeof document !== "undefined") {
  document.addEventListener("DOMContentLoaded", () => {
    const root = document.querySelector('[data-app="options"]') ?? document.body;
    root.innerHTML = OPTIONS_MARKUP;
    void createOptions(document, { loadSettings: storageLoadSettings, saveSettings: storageSaveSettings });
  });
}
