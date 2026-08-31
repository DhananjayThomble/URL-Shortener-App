import { beforeEach, describe, expect, it, vi } from "vitest";

import { createOptions, OPTIONS_MARKUP } from "./options.js";
import type { OptionsDeps } from "./options.js";
import type { Settings } from "./lib/storage.js";

/*
 * Options controller DOM tests.
 *
 * The options page is where the user points the extension at their own API and
 * pastes a scoped key, so its job is load / validate / save. Storage is
 * injected so the round trip is exercised without chrome.storage.
 */

function mountDom(): void {
  document.body.innerHTML = OPTIONS_MARKUP;
}

function makeDeps(overrides: Partial<OptionsDeps> = {}): OptionsDeps {
  const stored: Settings = { apiBaseUrl: "", apiKey: "" };
  return {
    loadSettings: vi.fn(async () => ({ ...stored })),
    saveSettings: vi.fn(async (s: Settings) => ({ ...s })),
    ...overrides,
  };
}

async function flush(): Promise<void> {
  await Promise.resolve();
  await Promise.resolve();
  await new Promise((r) => setTimeout(r, 0));
}

function fieldValue(sel: string): string {
  return document.querySelector<HTMLInputElement>(sel)!.value;
}

function setField(sel: string, value: string): void {
  const el = document.querySelector<HTMLInputElement>(sel)!;
  el.value = value;
}

describe("options controller", () => {
  beforeEach(() => {
    mountDom();
    vi.clearAllMocks();
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

    expect(fieldValue('[data-field="apiBaseUrl"]')).toBe("https://snapurl.example");
    expect(fieldValue('[data-field="apiKey"]')).toBe("snap_live_secret");
    expect(fieldValue('[data-field="defaultDomain"]')).toBe("snp.li");
  });

  it("saves the api base url, api key and default domain to storage", async () => {
    const deps = makeDeps();
    await createOptions(document, deps);
    await flush();

    setField('[data-field="apiBaseUrl"]', "https://my-host.example/");
    setField('[data-field="apiKey"]', "snap_live_abc");
    setField('[data-field="defaultDomain"]', "go.example");

    document.querySelector<HTMLFormElement>('[data-testid="options-form"]')!.requestSubmit();
    await flush();

    expect(deps.saveSettings).toHaveBeenCalledTimes(1);
    const saved = (deps.saveSettings as ReturnType<typeof vi.fn>).mock.calls[0]![0];
    expect(saved.apiBaseUrl).toBe("https://my-host.example/");
    expect(saved.apiKey).toBe("snap_live_abc");
    expect(saved.defaultDomain).toBe("go.example");

    expect(document.querySelector<HTMLElement>('[data-testid="saved"]')?.hidden).toBe(false);
  });

  it("rejects a non-http(s) api base url and does not save", async () => {
    const deps = makeDeps();
    await createOptions(document, deps);
    await flush();

    setField('[data-field="apiBaseUrl"]', "ftp://nope.example");
    setField('[data-field="apiKey"]', "snap_live_abc");

    document.querySelector<HTMLFormElement>('[data-testid="options-form"]')!.requestSubmit();
    await flush();

    expect(deps.saveSettings).not.toHaveBeenCalled();
    const err = document.querySelector<HTMLElement>('[data-testid="options-error"]');
    expect(err?.hidden).toBe(false);
    expect(document.querySelector<HTMLElement>('[data-testid="saved"]')?.hidden).toBe(true);
  });

  it("rejects an empty api base url", async () => {
    const deps = makeDeps();
    await createOptions(document, deps);
    await flush();

    setField('[data-field="apiBaseUrl"]', "");
    setField('[data-field="apiKey"]', "snap_live_abc");

    document.querySelector<HTMLFormElement>('[data-testid="options-form"]')!.requestSubmit();
    await flush();

    expect(deps.saveSettings).not.toHaveBeenCalled();
    expect(document.querySelector<HTMLElement>('[data-testid="options-error"]')?.hidden).toBe(false);
  });
});
