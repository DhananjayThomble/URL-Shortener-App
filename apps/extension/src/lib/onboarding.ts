/* First-run onboarding state — pure, DOM-free, injected-storage.
 *
 * The #1 setup failure is a working key that still can't reach a *production*
 * API because the extension's own origin (chrome-extension://<id>) isn't in the
 * API's EXTENSION_ORIGINS allowlist (see SPEC §6). Onboarding walks the operator
 * through three steps — API base URL, scoped key, CORS allowlist + a real test
 * connection — and only a green test verdict finishes it.
 *
 * This module is the pure state machine plus the storage flag helpers. It holds
 * no DOM and no chrome globals directly (storage is injected), so it is unit
 * tested under vitest without a browser, matching the extension's injected-deps
 * convention.
 */

/** The ordered onboarding steps. */
export const ONBOARDING_STEPS = ["api-url", "api-key", "cors-test"] as const;
export type OnboardingStep = (typeof ONBOARDING_STEPS)[number];

/** The storage key holding the "onboarding completed" flag. */
export const ONBOARDING_DONE_KEY = "snapurl:onboarding-done";

/** Minimal async key/value store — chrome.storage.local satisfies this shape. */
export interface FlagStore {
  get(key: string): Promise<Record<string, unknown>>;
  set(items: Record<string, unknown>): Promise<void>;
}

/** Immutable onboarding position. Advancing/going back returns a new value. */
export interface OnboardingState {
  readonly index: number;
  readonly step: OnboardingStep;
  readonly isFirst: boolean;
  readonly isLast: boolean;
}

function at(index: number): OnboardingState {
  const clamped = Math.min(Math.max(index, 0), ONBOARDING_STEPS.length - 1);
  return {
    index: clamped,
    step: ONBOARDING_STEPS[clamped]!,
    isFirst: clamped === 0,
    isLast: clamped === ONBOARDING_STEPS.length - 1,
  };
}

/** The starting state (first step). */
export function startOnboarding(): OnboardingState {
  return at(0);
}

/** Move to the next step; clamps at the last step (never overruns). */
export function nextStep(state: OnboardingState): OnboardingState {
  return at(state.index + 1);
}

/** Move to the previous step; clamps at the first step (never underruns). */
export function previousStep(state: OnboardingState): OnboardingState {
  return at(state.index - 1);
}

/** Jump directly to a named step. */
export function goToStep(step: OnboardingStep): OnboardingState {
  return at(ONBOARDING_STEPS.indexOf(step));
}

/**
 * Whether the operator has already completed onboarding. Absent flag → false,
 * so a fresh install always onboards.
 */
export async function isOnboardingComplete(store: FlagStore): Promise<boolean> {
  const result = await store.get(ONBOARDING_DONE_KEY);
  return result[ONBOARDING_DONE_KEY] === true;
}

/** Record that onboarding finished (a green test-connection verdict on the last step). */
export async function markOnboardingComplete(store: FlagStore): Promise<void> {
  await store.set({ [ONBOARDING_DONE_KEY]: true });
}

/**
 * Build the exact `.env` line an operator adds to their API so this extension's
 * origin passes the production CORS allowlist. `id` is chrome.runtime.id.
 */
export function extensionOrigin(id: string): string {
  return `chrome-extension://${id}`;
}

/** The full copy-paste line for the API operator's .env (EXTENSION_ORIGINS). */
export function corsEnvLine(id: string): string {
  return `EXTENSION_ORIGINS=${extensionOrigin(id)}`;
}
