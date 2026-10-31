"use client";

import { useSyncExternalStore } from "react";

/* ============================================================
   Reduced motion — the single source of truth for "animate or not".

   The app expresses "no motion" two independent ways, and a correct
   answer is the OR of both:

   1. `window.matchMedia('(prefers-reduced-motion: reduce)')` — the OS
      setting, which the user never touches in-app.
   2. The `reduce-motion` class the theme provider toggles on
      `documentElement` (`theme/theme-provider.tsx`), stamped pre-paint
      in `app/layout.tsx` — the persisted in-app Appearance setting.

   `globals.css` already kills every CSS transition and animation under
   both of these. But Recharts animates in JavaScript, so the CSS
   kill-switch cannot reach it — a chart has to be told, in JS, not to
   animate. That is what this hook is for (#868).
   ============================================================ */

const MEDIA_QUERY = "(prefers-reduced-motion: reduce)";
const CLASS = "reduce-motion";

/**
 * Read the current reduced-motion state directly from the DOM — `true` if
 * EITHER the OS media query matches OR the `reduce-motion` class is present on
 * `documentElement`. SSR-safe: returns `false` when there is no `window`,
 * which matches the pre-paint default (the class is only ever added, never
 * assumed present, before hydration).
 */
export function reducedMotionActive(): boolean {
  if (typeof window === "undefined") return false;
  const byMedia = window.matchMedia?.(MEDIA_QUERY).matches ?? false;
  const byClass = document.documentElement.classList.contains(CLASS);
  return byMedia || byClass;
}

/**
 * Subscribe to BOTH signals so a change in either one re-renders the
 * consumer:
 *  - the media query, via its `change` event;
 *  - the `reduce-motion` class, via a `MutationObserver` on
 *    `documentElement`'s `class` attribute (the theme provider toggles it
 *    with `classList.toggle`, which fires no DOM event of its own).
 */
function subscribe(onChange: () => void): () => void {
  if (typeof window === "undefined") return () => {};

  const mql = window.matchMedia?.(MEDIA_QUERY);
  mql?.addEventListener("change", onChange);

  const observer = new MutationObserver(onChange);
  observer.observe(document.documentElement, { attributes: true, attributeFilter: ["class"] });

  return () => {
    mql?.removeEventListener("change", onChange);
    observer.disconnect();
  };
}

/**
 * React hook: `true` when the user has asked for reduced motion by either
 * signal, reactive to changes in either. Pass the negation to a Recharts
 * animation prop, e.g. `isAnimationActive={!reduced}`.
 *
 * Uses `useSyncExternalStore` so the server snapshot is a stable `false`
 * (no motion assumed before hydration) and the client stays in step with the
 * live DOM without a render-phase side effect.
 */
export function useReducedMotion(): boolean {
  return useSyncExternalStore(subscribe, reducedMotionActive, () => false);
}
