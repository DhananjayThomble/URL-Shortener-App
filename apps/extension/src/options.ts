/* The options + onboarding page controller.
 *
 * This is where the operator points the extension at their own SnapURL API,
 * pastes a scoped API key, picks a default domain, and — the biggest setup-
 * failure reducer — runs a real Test connection (a live GET /links?limit=1) that
 * reports an auth / network / generic verdict inline (SPEC §4.2, §6, F12). It
 * also surfaces this extension's own origin (chrome.runtime.id) and the exact
 * EXTENSION_ORIGINS .env line the API operator must add for production CORS.
 *
 * On first install it renders in ONBOARDING mode: a three-step stepper
 * (URL → key → CORS + test) whose last step finishes only on a green verdict.
 *
 * Every effect (storage, the test-connection probe, the resolved extension id,
 * clipboard, the onboarding-complete flag) is injected so the controller runs
 * headlessly under vitest — the extension's established injected-deps pattern.
 * wireOptions() binds the real chrome implementations at the bottom of the file.
 */

import { loadSettings as storageLoadSettings, normalizeApiBaseUrl, saveSettings as storageSaveSettings } from "./lib/storage.js";
import type { Settings } from "./lib/storage.js";
import { listLinks, AuthError, NetworkError, RateLimitError, ApiError } from "./lib/api-client.js";
import {
  corsEnvLine,
  extensionOrigin,
  isOnboardingComplete,
  markOnboardingComplete,
  nextStep,
  previousStep,
  startOnboarding,
  ONBOARDING_STEPS,
  type FlagStore,
  type OnboardingState,
} from "./lib/onboarding.js";
import { t } from "./lib/i18n-local.js";

/** The verdict kinds a Test connection resolves to. Drives the message + styling. */
export type ConnectionVerdict = "ok" | "auth" | "rate-limit" | "network" | "generic";

/** Injected effects, so the controller runs headlessly under vitest. */
export interface OptionsDeps {
  loadSettings: () => Promise<Settings>;
  saveSettings: (settings: Settings) => Promise<Settings>;
  /** Probe the API with the given settings; resolves to a verdict + human message. */
  testConnection: (settings: Settings) => Promise<{ verdict: ConnectionVerdict; message: string }>;
  /** This extension's origin id (chrome.runtime.id). Empty string when unavailable. */
  extensionId: () => string;
  /** Copy text to the clipboard; resolves true on success. */
  copyText: (text: string) => Promise<boolean>;
  /** Onboarding-complete flag store (chrome.storage.local-shaped). */
  flagStore: FlagStore;
  /** Whether to render in onboarding mode (first run) or the normal options view. */
  onboarding: boolean;
}

/**
 * Default test-connection probe: a real GET /links?limit=1. A 200 means the key
 * works and the origin is allowed; the client's typed errors map straight to a
 * verdict. Injected in tests so no network is touched.
 */
export async function probeConnection(settings: Settings): Promise<{ verdict: ConnectionVerdict; message: string }> {
  if (!settings.apiBaseUrl.trim() || !settings.apiKey.trim()) {
    return { verdict: "generic", message: t("verdictNeedsConfig") };
  }
  try {
    await listLinks(settings, { limit: 1 });
    return { verdict: "ok", message: t("verdictOk") };
  } catch (error) {
    if (error instanceof AuthError) return { verdict: "auth", message: t("verdictAuth") };
    if (error instanceof RateLimitError) return { verdict: "rate-limit", message: error.message };
    if (error instanceof NetworkError) return { verdict: "network", message: t("verdictNetwork") };
    if (error instanceof ApiError) return { verdict: "generic", message: error.message || t("verdictGeneric") };
    return { verdict: "generic", message: t("verdictGeneric") };
  }
}

/** The options page's static DOM, shared by options.html and the tests. */
export const OPTIONS_MARKUP = `
<main class="options" data-testid="options-root">
  <h1 class="options__title">${t("optionsTitle")}</h1>
  <p class="options__intro">${t("optionsIntro")}</p>

  <div class="onboarding" data-testid="onboarding" hidden>
    <ol class="onboarding__steps" data-testid="onboarding-steps">
      <li data-step="api-url">${t("stepApiUrlTitle")}</li>
      <li data-step="api-key">${t("stepApiKeyTitle")}</li>
      <li data-step="cors-test">${t("stepCorsTitle")}</li>
    </ol>
  </div>

  <form data-testid="options-form" class="options__form" novalidate>
    <section class="options__section" data-section="connection">
      <h2 class="options__section-title">${t("sectionConnection")}</h2>

      <label class="field__label" for="apiBaseUrl">${t("labelApiBaseUrl")}</label>
      <input id="apiBaseUrl" class="field__input" data-field="apiBaseUrl" type="url" placeholder="https://your-host" autocomplete="off" />

      <label class="field__label" for="apiKey">${t("labelApiKey")}</label>
      <div class="field__key-row">
        <input id="apiKey" class="field__input" data-field="apiKey" type="password" placeholder="snap_live_…" autocomplete="off" />
        <button type="button" class="btn btn--ghost" data-action="toggle-key" aria-pressed="false">${t("showKey")}</button>
      </div>
      <p class="field__hint">${t("hintApiKeyScopes")}</p>

      <div class="options__test-row">
        <button type="button" class="btn btn--ghost" data-action="test-connection">${t("testConnection")}</button>
        <span class="onboarding__verdict" data-testid="verdict" data-kind="" hidden></span>
      </div>
    </section>

    <section class="options__section" data-section="defaults">
      <h2 class="options__section-title">${t("sectionDefaults")}</h2>
      <label class="field__label" for="defaultDomain">${t("labelDefaultDomain")}</label>
      <input id="defaultDomain" class="field__input" data-field="defaultDomain" type="text" placeholder="go.example" autocomplete="off" />
      <p class="field__hint">${t("hintDefaultDomain")}</p>
    </section>

    <section class="options__section" data-section="cors">
      <h2 class="options__section-title">${t("sectionCors")}</h2>
      <p class="field__hint">${t("corsIntro")}</p>
      <label class="field__label">${t("corsIdLabel")}</label>
      <div class="field__key-row">
        <code class="options__origin" data-testid="extension-origin"></code>
        <button type="button" class="btn btn--ghost" data-action="copy-origin">${t("copy")}</button>
      </div>
      <label class="field__label">${t("corsEnvLabel")}</label>
      <div class="field__key-row">
        <code class="options__env" data-testid="cors-env"></code>
        <button type="button" class="btn btn--ghost" data-action="copy-env">${t("copy")}</button>
      </div>
    </section>

    <section class="options__section" data-section="shortcuts">
      <h2 class="options__section-title">${t("sectionShortcuts")}</h2>
      <p class="field__hint">${t("shortcutsIntro")}</p>
    </section>

    <div class="options__actions">
      <button type="button" class="btn btn--ghost" data-action="back" hidden>${t("back")}</button>
      <button type="submit" class="btn btn--primary" data-action="save">${t("save")}</button>
    </div>
  </form>

  <p class="options__saved" data-testid="saved" hidden>${t("saved")}</p>
  <p class="options__error field__error" data-testid="options-error" hidden></p>
</main>
`;

function show(el: HTMLElement | null, visible: boolean): void {
  if (el) el.hidden = !visible;
}

function field(doc: Document, name: string): HTMLInputElement | null {
  return doc.querySelector<HTMLInputElement>(`[data-field="${name}"]`);
}

function readForm(doc: Document): Settings {
  const apiBaseUrl = field(doc, "apiBaseUrl")?.value ?? "";
  const apiKey = field(doc, "apiKey")?.value ?? "";
  const domain = field(doc, "defaultDomain")?.value.trim() ?? "";
  return { apiBaseUrl, apiKey, ...(domain ? { defaultDomain: domain } : {}) };
}

/**
 * Wire the options controller to a document. Resolves once the current settings
 * have been loaded into the form (and onboarding mode, if any, is applied).
 */
export async function createOptions(doc: Document, deps: OptionsDeps): Promise<void> {
  const form = doc.querySelector<HTMLFormElement>('[data-testid="options-form"]');
  const apiBaseUrl = field(doc, "apiBaseUrl");
  const apiKey = field(doc, "apiKey");
  const defaultDomain = field(doc, "defaultDomain");
  const saved = doc.querySelector<HTMLElement>('[data-testid="saved"]');
  const error = doc.querySelector<HTMLElement>('[data-testid="options-error"]');
  const verdictEl = doc.querySelector<HTMLElement>('[data-testid="verdict"]');
  const onboardingEl = doc.querySelector<HTMLElement>('[data-testid="onboarding"]');
  const originEl = doc.querySelector<HTMLElement>('[data-testid="extension-origin"]');
  const envEl = doc.querySelector<HTMLElement>('[data-testid="cors-env"]');
  const toggleKeyBtn = doc.querySelector<HTMLButtonElement>('[data-action="toggle-key"]');
  const testBtn = doc.querySelector<HTMLButtonElement>('[data-action="test-connection"]');
  const backBtn = doc.querySelector<HTMLButtonElement>('[data-action="back"]');
  const saveBtn = doc.querySelector<HTMLButtonElement>('[data-action="save"]');
  const copyOriginBtn = doc.querySelector<HTMLButtonElement>('[data-action="copy-origin"]');
  const copyEnvBtn = doc.querySelector<HTMLButtonElement>('[data-action="copy-env"]');

  const settings = await deps.loadSettings();
  if (apiBaseUrl) apiBaseUrl.value = settings.apiBaseUrl;
  if (apiKey) apiKey.value = settings.apiKey;
  if (defaultDomain) defaultDomain.value = settings.defaultDomain ?? "";

  // CORS / extension-origin surface.
  const id = deps.extensionId();
  if (originEl) originEl.textContent = id ? extensionOrigin(id) : extensionOrigin("<load-unpacked-to-see-id>");
  if (envEl) envEl.textContent = corsEnvLine(id || "<id>");

  // Onboarding mode: reveal the stepper and constrain the flow to one step.
  let obState: OnboardingState | null = deps.onboarding ? startOnboarding() : null;
  if (deps.onboarding) show(onboardingEl, true);
  applyOnboarding();

  function applyOnboarding(): void {
    // Highlight the active step and toggle Back/Save-vs-Next affordances.
    const steps = doc.querySelectorAll<HTMLElement>('[data-testid="onboarding-steps"] li');
    steps.forEach((li) => {
      const active = obState !== null && li.getAttribute("data-step") === obState.step;
      li.classList.toggle("onboarding__step--active", active);
      li.setAttribute("aria-current", active ? "step" : "false");
    });
    if (!obState) {
      show(backBtn, false);
      if (saveBtn) saveBtn.textContent = t("save");
      return;
    }
    show(backBtn, !obState.isFirst);
    if (saveBtn) saveBtn.textContent = obState.isLast ? t("finish") : t("next");
  }

  function setVerdict(kind: ConnectionVerdict | "", message: string): void {
    if (!verdictEl) return;
    verdictEl.textContent = message;
    verdictEl.setAttribute("data-kind", kind);
    show(verdictEl, Boolean(message));
  }

  toggleKeyBtn?.addEventListener("click", () => {
    if (!apiKey) return;
    const revealed = apiKey.type === "text";
    apiKey.type = revealed ? "password" : "text";
    toggleKeyBtn.textContent = revealed ? t("showKey") : t("hideKey");
    toggleKeyBtn.setAttribute("aria-pressed", String(!revealed));
  });

  testBtn?.addEventListener("click", () => void runTest());

  async function runTest(): Promise<{ verdict: ConnectionVerdict } | undefined> {
    setVerdict("", t("testing"));
    if (testBtn) testBtn.disabled = true;
    try {
      const result = await deps.testConnection(readForm(doc));
      setVerdict(result.verdict, result.message);
      return result;
    } catch {
      setVerdict("generic", t("verdictGeneric"));
      return { verdict: "generic" };
    } finally {
      if (testBtn) testBtn.disabled = false;
    }
  }

  copyOriginBtn?.addEventListener("click", () => {
    if (id) void copyThen(copyOriginBtn, extensionOrigin(id));
  });
  copyEnvBtn?.addEventListener("click", () => {
    void copyThen(copyEnvBtn, corsEnvLine(id || "<id>"));
  });

  async function copyThen(btn: HTMLButtonElement, text: string): Promise<void> {
    const ok = await deps.copyText(text);
    if (ok) {
      const original = btn.textContent;
      btn.textContent = t("copied");
      setTimeout(() => {
        btn.textContent = original;
      }, 1200);
    }
  }

  backBtn?.addEventListener("click", () => {
    if (!obState) return;
    obState = previousStep(obState);
    applyOnboarding();
  });

  form?.addEventListener("submit", (event) => {
    event.preventDefault();
    void submit();
  });

  async function submit(): Promise<void> {
    show(saved, false);
    show(error, false);

    // Onboarding advances step-by-step; the last step gates on a green test.
    if (obState) {
      if (!obState.isLast) {
        // Validate the URL before leaving the first step.
        if (obState.step === "api-url") {
          try {
            normalizeApiBaseUrl(apiBaseUrl?.value ?? "");
          } catch (validationError) {
            if (error) error.textContent = validationError instanceof Error ? validationError.message : "Invalid API base URL.";
            show(error, true);
            return;
          }
        }
        obState = nextStep(obState);
        applyOnboarding();
        return;
      }
      // Last step: run the test, and only finish on a green verdict.
      const result = await runTest();
      if (result?.verdict !== "ok") return;
      const persisted = await persist();
      if (!persisted) return;
      await markOnboardingComplete(deps.flagStore);
      obState = null;
      show(onboardingEl, false);
      applyOnboarding();
      show(saved, true);
      return;
    }

    await persist();
  }

  async function persist(): Promise<boolean> {
    const rawBaseUrl = apiBaseUrl?.value ?? "";
    try {
      normalizeApiBaseUrl(rawBaseUrl);
    } catch (validationError) {
      if (error) error.textContent = validationError instanceof Error ? validationError.message : "Invalid API base URL.";
      show(error, true);
      return false;
    }

    const next = readForm(doc);
    try {
      await deps.saveSettings(next);
      show(saved, true);
      return true;
    } catch (saveError) {
      if (error) error.textContent = saveError instanceof Error ? saveError.message : "Could not save settings.";
      show(error, true);
      return false;
    }
  }
}

/* ---- Browser wiring (guarded on the chrome global; not run in tests) ---- */

function browserFlagStore(): FlagStore {
  return {
    get: (key: string) => chrome.storage.local.get(key) as Promise<Record<string, unknown>>,
    set: (items: Record<string, unknown>) => chrome.storage.local.set(items),
  };
}

async function copyToClipboard(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    return false;
  }
}

if (typeof chrome !== "undefined" && chrome.storage && typeof document !== "undefined") {
  document.addEventListener("DOMContentLoaded", () => {
    void (async () => {
      const flagStore = browserFlagStore();
      const onboarding = !(await isOnboardingComplete(flagStore));
      const root = document.querySelector('[data-app="options"]') ?? document.body;
      root.innerHTML = OPTIONS_MARKUP;
      await createOptions(document, {
        loadSettings: storageLoadSettings,
        saveSettings: storageSaveSettings,
        testConnection: probeConnection,
        extensionId: () => chrome.runtime?.id ?? "",
        copyText: copyToClipboard,
        flagStore,
        onboarding,
      });
    })();
  });
}

// Keep ONBOARDING_STEPS referenced for consumers/tooling that import the surface.
export { ONBOARDING_STEPS };
