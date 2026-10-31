// @vitest-environment happy-dom
//
// #868 — the traffic chart must honour reduced motion. globals.css already
// kills CSS motion under `:root.reduce-motion` and the prefers-reduced-motion
// media query, but Recharts animates in JS and ignores both, so the chart kept
// animating on mount for a user who asked for no motion.
//
// This file tests the hook directly against a DOM: the class signal, the
// media-query signal, and reactivity to a change in EITHER one. The <Area>
// wiring (isAnimationActive={!reduced}) is proved in charts/traffic-animation.test.ts.

// React requires this flag to run act() outside a test renderer; without it
// act warns and does not reliably flush passive effects.
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

import { act, createElement } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { reducedMotionActive, useReducedMotion } from "./use-reduced-motion";

const MEDIA_QUERY = "(prefers-reduced-motion: reduce)";

// happy-dom's matchMedia always reports matches=false and never fires a change
// event, so drive it ourselves: one controllable query with real listeners.
type Listener = (e: { matches: boolean; media: string }) => void;

function installMatchMedia() {
  const state = { reduce: false };
  const listeners = new Set<Listener>();
  const mql = {
    get matches() {
      return state.reduce;
    },
    media: MEDIA_QUERY,
    addEventListener: (_type: "change", cb: Listener) => listeners.add(cb),
    removeEventListener: (_type: "change", cb: Listener) => listeners.delete(cb),
  };
  window.matchMedia = ((query: string) => {
    if (query !== MEDIA_QUERY) {
      return {
        matches: false,
        media: query,
        addEventListener() {},
        removeEventListener() {},
      } as unknown as MediaQueryList;
    }
    return mql as unknown as MediaQueryList;
  }) as typeof window.matchMedia;

  return {
    setReduce(v: boolean) {
      state.reduce = v;
      for (const cb of listeners) cb({ matches: v, media: MEDIA_QUERY });
    },
  };
}

let media: ReturnType<typeof installMatchMedia>;

beforeEach(() => {
  document.documentElement.classList.remove("reduce-motion");
  media = installMatchMedia();
});

afterEach(() => {
  document.documentElement.classList.remove("reduce-motion");
});

/** Mount `useReducedMotion()` into a real root; returns its live value + teardown. */
async function mountHook(): Promise<{ value: () => boolean; mutate: (fn: () => void) => Promise<void>; unmount: () => Promise<void> }> {
  const host = document.createElement("div");
  document.body.appendChild(host);
  const root = createRoot(host);
  let latest = false;
  function Probe() {
    latest = useReducedMotion();
    return null;
  }
  await act(async () => {
    root.render(createElement(Probe));
  });
  return {
    value: () => latest,
    // Apply a DOM mutation and let it settle inside act(): the class signal
    // arrives via a MutationObserver, whose records happy-dom delivers on a
    // macrotask (not a microtask), so wait a task tick before the assertion —
    // and do it inside act() so the resulting React update is flushed and
    // React does not warn about an un-acted update.
    mutate: async (fn: () => void) => {
      await act(async () => {
        fn();
        await new Promise((resolve) => setTimeout(resolve, 0));
      });
    },
    unmount: async () => {
      await act(async () => root.unmount());
      host.remove();
    },
  };
}

describe("reducedMotionActive — pure read of both signals", () => {
  it("is false when neither the class nor the media query is set", () => {
    expect(reducedMotionActive()).toBe(false);
  });

  it("is true when ONLY the reduce-motion class is set", () => {
    document.documentElement.classList.add("reduce-motion");
    expect(reducedMotionActive()).toBe(true);
  });

  it("is true when ONLY the media query matches", () => {
    media.setReduce(true);
    expect(reducedMotionActive()).toBe(true);
  });

  it("is true when BOTH are set", () => {
    document.documentElement.classList.add("reduce-motion");
    media.setReduce(true);
    expect(reducedMotionActive()).toBe(true);
  });
});

describe("useReducedMotion — hook reacts to EITHER signal changing", () => {
  it("starts false, then turns true when the reduce-motion CLASS is added", async () => {
    const h = await mountHook();
    expect(h.value()).toBe(false);

    await h.mutate(() => document.documentElement.classList.add("reduce-motion"));
    expect(h.value()).toBe(true);

    // ...and back to false when the class is removed.
    await h.mutate(() => document.documentElement.classList.remove("reduce-motion"));
    expect(h.value()).toBe(false);

    await h.unmount();
  });

  it("starts false, then turns true when the MEDIA QUERY starts matching", async () => {
    const h = await mountHook();
    expect(h.value()).toBe(false);

    await h.mutate(() => media.setReduce(true));
    expect(h.value()).toBe(true);

    await h.unmount();
  });
});
