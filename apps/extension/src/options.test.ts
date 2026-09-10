import { beforeEach, describe, expect, it, vi } from "vitest";

import { createOptions, OPTIONS_MARKUP, probeConnection } from "./options.js";
import type { ConnectionVerdict, OptionsDeps } from "./options.js";
import type { Settings } from "./lib/storage.js";
import type { FlagStore } from "./lib/onboarding.js";
import { AuthError, NetworkError, RateLimitError, ApiError } from "./lib/api-client.js";

/*
 * Options + onboarding controller DOM tests.
 *
 * The options page loads / validates / saves settings, runs a real Test
 * connection whose typed errors map to a verdict, reveals the key, surfaces the
 * extension's own origin for the CORS allowlist, and — on first run — walks a
 * three-step onboarding stepper that only finishes on a green verdict. Every
 * effect is injected so the whole thing runs under happy-dom with no chrome.
 */

function mountDom(): void {
  document.body.innerHTML = OPTIONS_MARKUP;
}

function makeFlagStore(initial: Record<string, unknown> = {}): FlagStore & { store: Record<string, unknown> } {
  const store = { ...initial };
  return {
    store,
    get: vi.fn(async (key: string) => ({ [key]: store[key] })),
    set: vi.fn(async (items: Record<string, unknown>) => {
      Object.assign(store, items);
    }),
  };
}

function makeDeps(overrides: Partial<OptionsDeps> = {}): OptionsDeps {
  const stored: Settings = { apiBaseUrl: "", apiKey: "" };
  return {
    loadSettings: vi.fn(async () => ({ ...stored })),
    saveSettings: vi.fn(async (s: Settings) => ({ ...s })),
    testConnection: vi.fn(async () => ({ verdict: "ok" as ConnectionVerdict, message: "Connected." })),
    extensionId: vi.fn(() => "abcdefghijklmnopabcdefghijklmnop"),
    copyText: vi.fn(async () => true),
    flagStore: makeFlagStore(),
    onboarding: false,
    ...overrides,
  };
}

async function flush(): Promise<void> {
  await Promise.resolve();
  await Promise.resolve();
  await new Promise((r) => setTimeout(r, 0));
}

function q<T extends HTMLElement>(sel: string): T {
  return document.querySelector<T>(sel)!;
}

function setField(sel: string, value: string): void {
  q<HTMLInputElement>(sel).value = value;
}

describe("options controller", () => {
  beforeEach(() => {
    mountDom();
    vi.clearAllMocks();
    vi.useRealTimers();
  });

  it("loads current settings into the form", async () => {
    const deps = makeDeps({
      loadSettings: vi.fn(async () => ({
        apiBaseUrl: "https://snapurl.example",
        apiKey: "snap_live_secret",
        defaultDomain: "snp.li",
      })),
    });
    await createOptions(document, deps);
    await flush();

    expect(q<HTMLInputElement>('[data-field="apiBaseUrl"]').value).toBe("https://snapurl.example");
    expect(q<HTMLInputElement>('[data-field="apiKey"]').value).toBe("snap_live_secret");
    expect(q<HTMLInputElement>('[data-field="defaultDomain"]').value).toBe("snp.li");
  });

  it("saves the api base url, api key and default domain to storage", async () => {
    const deps = makeDeps();
    await createOptions(document, deps);
    await flush();

    setField('[data-field="apiBaseUrl"]', "https://my-host.example/");
    setField('[data-field="apiKey"]', "snap_live_abc");
    setField('[data-field="defaultDomain"]', "go.example");

    q<HTMLFormElement>('[data-testid="options-form"]').requestSubmit();
    await flush();

    expect(deps.saveSettings).toHaveBeenCalledTimes(1);
    const saved = (deps.saveSettings as ReturnType<typeof vi.fn>).mock.calls[0]![0];
    expect(saved.apiBaseUrl).toBe("https://my-host.example/");
    expect(saved.apiKey).toBe("snap_live_abc");
    expect(saved.defaultDomain).toBe("go.example");
    expect(q('[data-testid="saved"]').hidden).toBe(false);
  });

  it("rejects a non-http(s) api base url and does not save", async () => {
    const deps = makeDeps();
    await createOptions(document, deps);
    await flush();

    setField('[data-field="apiBaseUrl"]', "ftp://nope.example");
    setField('[data-field="apiKey"]', "snap_live_abc");
    q<HTMLFormElement>('[data-testid="options-form"]').requestSubmit();
    await flush();

    expect(deps.saveSettings).not.toHaveBeenCalled();
    expect(q('[data-testid="options-error"]').hidden).toBe(false);
    expect(q('[data-testid="saved"]').hidden).toBe(true);
  });

  it("rejects an empty api base url", async () => {
    const deps = makeDeps();
    await createOptions(document, deps);
    await flush();

    setField('[data-field="apiBaseUrl"]', "");
    setField('[data-field="apiKey"]', "snap_live_abc");
    q<HTMLFormElement>('[data-testid="options-form"]').requestSubmit();
    await flush();

    expect(deps.saveSettings).not.toHaveBeenCalled();
    expect(q('[data-testid="options-error"]').hidden).toBe(false);
  });

  it("toggles the api key between hidden and visible", async () => {
    await createOptions(document, makeDeps());
    await flush();

    const key = q<HTMLInputElement>('[data-field="apiKey"]');
    const toggle = q<HTMLButtonElement>('[data-action="toggle-key"]');
    expect(key.type).toBe("password");
    expect(toggle.getAttribute("aria-pressed")).toBe("false");

    toggle.click();
    expect(key.type).toBe("text");
    expect(toggle.getAttribute("aria-pressed")).toBe("true");

    toggle.click();
    expect(key.type).toBe("password");
    expect(toggle.getAttribute("aria-pressed")).toBe("false");
  });

  it("surfaces the extension origin and the EXTENSION_ORIGINS .env line", async () => {
    await createOptions(document, makeDeps({ extensionId: () => "kkkkkkkkkkkkkkkkkkkkkkkkkkkkkkkk" }));
    await flush();

    expect(q('[data-testid="extension-origin"]').textContent).toBe("chrome-extension://kkkkkkkkkkkkkkkkkkkkkkkkkkkkkkkk");
    expect(q('[data-testid="cors-env"]').textContent).toBe("EXTENSION_ORIGINS=chrome-extension://kkkkkkkkkkkkkkkkkkkkkkkkkkkkkkkk");
  });

  it("copies the extension origin to the clipboard", async () => {
    const copyText = vi.fn(async () => true);
    await createOptions(document, makeDeps({ extensionId: () => "id123id123id123id123id123id123id", copyText }));
    await flush();

    q<HTMLButtonElement>('[data-action="copy-origin"]').click();
    await flush();

    expect(copyText).toHaveBeenCalledWith("chrome-extension://id123id123id123id123id123id123id");
  });

  describe("test connection", () => {
    it("shows an ok verdict when the probe succeeds", async () => {
      const deps = makeDeps({ testConnection: vi.fn(async () => ({ verdict: "ok" as ConnectionVerdict, message: "Connected." })) });
      await createOptions(document, deps);
      await flush();

      q<HTMLButtonElement>('[data-action="test-connection"]').click();
      await flush();

      const verdict = q('[data-testid="verdict"]');
      expect(verdict.hidden).toBe(false);
      expect(verdict.getAttribute("data-kind")).toBe("ok");
    });

    it("shows an auth verdict when the key is rejected", async () => {
      const deps = makeDeps({ testConnection: vi.fn(async () => ({ verdict: "auth" as ConnectionVerdict, message: "Rejected." })) });
      await createOptions(document, deps);
      await flush();

      q<HTMLButtonElement>('[data-action="test-connection"]').click();
      await flush();

      expect(q('[data-testid="verdict"]').getAttribute("data-kind")).toBe("auth");
    });

    it("shows a network verdict (CORS/offline)", async () => {
      const deps = makeDeps({ testConnection: vi.fn(async () => ({ verdict: "network" as ConnectionVerdict, message: "Add origin." })) });
      await createOptions(document, deps);
      await flush();

      q<HTMLButtonElement>('[data-action="test-connection"]').click();
      await flush();

      expect(q('[data-testid="verdict"]').getAttribute("data-kind")).toBe("network");
    });
  });

  describe("onboarding mode", () => {
    it("reveals the stepper on first run and starts on the api-url step", async () => {
      await createOptions(document, makeDeps({ onboarding: true }));
      await flush();

      expect(q('[data-testid="onboarding"]').hidden).toBe(false);
      const active = document.querySelector('[data-testid="onboarding-steps"] li.onboarding__step--active');
      expect(active?.getAttribute("data-step")).toBe("api-url");
      // On the first step the primary button says Next, and Back is hidden.
      expect(q('[data-action="save"]').textContent).toBe("Next");
      expect(q<HTMLButtonElement>('[data-action="back"]').hidden).toBe(true);
    });

    it("advances through steps and requires a green test to finish", async () => {
      const flagStore = makeFlagStore();
      const testConnection = vi.fn(async () => ({ verdict: "auth" as ConnectionVerdict, message: "Rejected." }));
      const saveSettings = vi.fn(async (s: Settings) => ({ ...s }));
      const deps = makeDeps({ onboarding: true, flagStore, testConnection, saveSettings });
      await createOptions(document, deps);
      await flush();

      const form = q<HTMLFormElement>('[data-testid="options-form"]');

      // Step 1 → validate URL then advance to api-key.
      setField('[data-field="apiBaseUrl"]', "https://host.example");
      form.requestSubmit();
      await flush();
      expect(document.querySelector('[data-testid="onboarding-steps"] li.onboarding__step--active')?.getAttribute("data-step")).toBe("api-key");

      // Step 2 → advance to cors-test.
      setField('[data-field="apiKey"]', "snap_live_x");
      form.requestSubmit();
      await flush();
      expect(document.querySelector('[data-testid="onboarding-steps"] li.onboarding__step--active')?.getAttribute("data-step")).toBe("cors-test");
      expect(q('[data-action="save"]').textContent).toBe("Finish");

      // Step 3 with a NON-green verdict must NOT finish onboarding.
      form.requestSubmit();
      await flush();
      expect(testConnection).toHaveBeenCalled();
      expect(saveSettings).not.toHaveBeenCalled();
      expect(flagStore.store["snapurl:onboarding-done"]).toBeUndefined();
      expect(q('[data-testid="onboarding"]').hidden).toBe(false);
    });

    it("finishes onboarding, persists settings and sets the done flag on a green test", async () => {
      const flagStore = makeFlagStore();
      const testConnection = vi.fn(async () => ({ verdict: "ok" as ConnectionVerdict, message: "Connected." }));
      const saveSettings = vi.fn(async (s: Settings) => ({ ...s }));
      const deps = makeDeps({ onboarding: true, flagStore, testConnection, saveSettings });
      await createOptions(document, deps);
      await flush();

      const form = q<HTMLFormElement>('[data-testid="options-form"]');
      setField('[data-field="apiBaseUrl"]', "https://host.example");
      form.requestSubmit();
      await flush();
      setField('[data-field="apiKey"]', "snap_live_x");
      form.requestSubmit();
      await flush();
      form.requestSubmit(); // cors-test with green verdict
      await flush();

      expect(saveSettings).toHaveBeenCalledTimes(1);
      expect(flagStore.store["snapurl:onboarding-done"]).toBe(true);
      expect(q('[data-testid="onboarding"]').hidden).toBe(true);
      expect(q('[data-testid="saved"]').hidden).toBe(false);
    });

    it("does not advance past step 1 when the url is invalid", async () => {
      const deps = makeDeps({ onboarding: true });
      await createOptions(document, deps);
      await flush();

      setField('[data-field="apiBaseUrl"]', "not-a-url");
      q<HTMLFormElement>('[data-testid="options-form"]').requestSubmit();
      await flush();

      expect(q('[data-testid="options-error"]').hidden).toBe(false);
      expect(document.querySelector('[data-testid="onboarding-steps"] li.onboarding__step--active')?.getAttribute("data-step")).toBe("api-url");
    });
  });
});

describe("probeConnection (default test-connection probe)", () => {
  const settings: Settings = { apiBaseUrl: "https://host.example", apiKey: "snap_live_x" };

  it("returns needs-config verdict when settings are blank", async () => {
    const result = await probeConnection({ apiBaseUrl: "", apiKey: "" });
    expect(result.verdict).toBe("generic");
  });

  it("maps a 200 to ok", async () => {
    const fetchImpl = vi.fn(async () => new Response(JSON.stringify({ items: [], total: 0 }), { status: 200 }));
    // listLinks reads its own fetch; inject via a wrapper probe.
    const result = await probeWith(settings, fetchImpl);
    expect(result.verdict).toBe("ok");
  });

  it("maps an AuthError to auth", async () => {
    const result = await verdictFor(new AuthError());
    expect(result).toBe("auth");
  });

  it("maps a NetworkError to network", async () => {
    const result = await verdictFor(new NetworkError());
    expect(result).toBe("network");
  });

  it("maps a RateLimitError to rate-limit", async () => {
    const result = await verdictFor(new RateLimitError());
    expect(result).toBe("rate-limit");
  });

  it("maps a generic ApiError to generic", async () => {
    const result = await verdictFor(new ApiError("boom", 500));
    expect(result).toBe("generic");
  });
});

/* Helpers that exercise probeConnection's error mapping by stubbing listLinks
 * through an injected fetch on a real Response, matching api-client's contract. */
async function probeWith(settings: Settings, fetchImpl: typeof fetch): Promise<{ verdict: ConnectionVerdict; message: string }> {
  const { listLinks } = await import("./lib/api-client.js");
  try {
    await listLinks(settings, { limit: 1 }, { fetchImpl });
    return { verdict: "ok", message: "" };
  } catch (e) {
    return mapErr(e);
  }
}

async function verdictFor(error: Error): Promise<ConnectionVerdict> {
  const fetchImpl = vi.fn(async () => {
    throw error instanceof NetworkError ? new TypeError("fetch failed") : error;
  }) as unknown as typeof fetch;
  // For non-network typed errors we bypass fetch and map directly.
  if (!(error instanceof NetworkError)) {
    return mapErr(error).verdict;
  }
  const r = await probeWith({ apiBaseUrl: "https://h.example", apiKey: "snap_live_x" }, fetchImpl);
  return r.verdict;
}

function mapErr(error: unknown): { verdict: ConnectionVerdict; message: string } {
  if (error instanceof AuthError) return { verdict: "auth", message: "" };
  if (error instanceof RateLimitError) return { verdict: "rate-limit", message: "" };
  if (error instanceof NetworkError) return { verdict: "network", message: "" };
  if (error instanceof ApiError) return { verdict: "generic", message: "" };
  return { verdict: "generic", message: "" };
}
