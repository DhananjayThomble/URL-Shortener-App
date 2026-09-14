import { describe, expect, it, vi } from "vitest";

import {
  ONBOARDING_STEPS,
  ONBOARDING_DONE_KEY,
  corsEnvLine,
  extensionOrigin,
  goToStep,
  isOnboardingComplete,
  markOnboardingComplete,
  nextStep,
  previousStep,
  startOnboarding,
  type FlagStore,
} from "./onboarding.js";

/*
 * Pure onboarding state-machine + flag-store tests (no DOM, no chrome).
 * The stepper drives first-run setup; its correctness (no over/underrun, the
 * done flag round-trip, the exact CORS .env line) is the load-bearing bit.
 */

function memStore(initial: Record<string, unknown> = {}): FlagStore & { data: Record<string, unknown> } {
  const data = { ...initial };
  return {
    data,
    get: vi.fn(async (key: string) => ({ [key]: data[key] })),
    set: vi.fn(async (items: Record<string, unknown>) => {
      Object.assign(data, items);
    }),
  };
}

describe("onboarding state machine", () => {
  it("starts on the first step", () => {
    const s = startOnboarding();
    expect(s.step).toBe("api-url");
    expect(s.index).toBe(0);
    expect(s.isFirst).toBe(true);
    expect(s.isLast).toBe(false);
  });

  it("advances through all steps and clamps at the last", () => {
    let s = startOnboarding();
    s = nextStep(s);
    expect(s.step).toBe("api-key");
    s = nextStep(s);
    expect(s.step).toBe("cors-test");
    expect(s.isLast).toBe(true);
    // Overrun clamps.
    s = nextStep(s);
    expect(s.step).toBe("cors-test");
    expect(s.index).toBe(ONBOARDING_STEPS.length - 1);
  });

  it("goes back and clamps at the first step", () => {
    let s = goToStep("cors-test");
    s = previousStep(s);
    expect(s.step).toBe("api-key");
    s = previousStep(s);
    expect(s.step).toBe("api-url");
    s = previousStep(s);
    expect(s.step).toBe("api-url");
    expect(s.isFirst).toBe(true);
  });

  it("jumps directly to a named step", () => {
    expect(goToStep("api-key").index).toBe(1);
    expect(goToStep("cors-test").index).toBe(2);
  });
});

describe("onboarding completion flag", () => {
  it("is false on a fresh store", async () => {
    expect(await isOnboardingComplete(memStore())).toBe(false);
  });

  it("round-trips the done flag", async () => {
    const store = memStore();
    await markOnboardingComplete(store);
    expect(store.data[ONBOARDING_DONE_KEY]).toBe(true);
    expect(await isOnboardingComplete(store)).toBe(true);
  });

  it("treats a non-true stored value as not complete", async () => {
    expect(await isOnboardingComplete(memStore({ [ONBOARDING_DONE_KEY]: "yes" }))).toBe(false);
  });
});

describe("CORS origin helpers", () => {
  it("builds the extension origin from an id", () => {
    expect(extensionOrigin("abc123")).toBe("chrome-extension://abc123");
  });

  it("builds the exact EXTENSION_ORIGINS env line", () => {
    expect(corsEnvLine("abc123")).toBe("EXTENSION_ORIGINS=chrome-extension://abc123");
  });
});
