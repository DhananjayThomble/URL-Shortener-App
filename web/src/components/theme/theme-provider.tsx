"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";

/* ============================================================
   Appearance is a product feature, not a build-time constant.

   The same state drives Settings > Appearance and anywhere else a
   theme control appears. It persists per-device; storage failures
   (private mode, blocked site data) fall back to defaults rather
   than throwing.
   ============================================================ */

export type Accent = { name: string; light: string; dark: string };

export const ACCENTS: Accent[] = [
  { name: "Cobalt", light: "#1F5FD4", dark: "#6FA8FF" },
  { name: "Magenta", light: "#D6156A", dark: "#FF5C9D" },
  { name: "Pine", light: "#0B7A6E", dark: "#3FD6BE" },
  { name: "Ember", light: "#C2410C", dark: "#FF9557" },
  { name: "Iris", light: "#5B4BC4", dark: "#9C8CFF" },
  { name: "Mono", light: "#1A1F27", dark: "#E9EEF4" },
];

export type Mode = "" | "light" | "dark";

export type Appearance = {
  accent: string;
  mode: Mode;
  density: string;
  radius: string;
  reduceMotion: boolean;
};

export const DEFAULT_APPEARANCE: Appearance = {
  accent: "Cobalt",
  mode: "",
  density: "1",
  radius: "9px",
  reduceMotion: false,
};

const KEY = "snapurl.appearance";

type Ctx = Appearance & {
  set: (patch: Partial<Appearance>) => void;
  reset: () => void;
};

const ThemeContext = createContext<Ctx | null>(null);

function read(): Appearance {
  try {
    const raw = window.localStorage.getItem(KEY);
    if (!raw) return DEFAULT_APPEARANCE;
    return { ...DEFAULT_APPEARANCE, ...(JSON.parse(raw) as Partial<Appearance>) };
  } catch {
    return DEFAULT_APPEARANCE;
  }
}

function hexToRgb(hex: string) {
  const n = parseInt(hex.slice(1), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

export function ThemeProvider({ children }: { children: React.ReactNode }) {
  const [state, setState] = useState<Appearance>(DEFAULT_APPEARANCE);

  // Read after mount: localStorage isn't available during SSR, and reading it
  // in useState would desync the server and client renders.
  useEffect(() => setState(read()), []);

  const apply = useCallback((s: Appearance) => {
    const root = document.documentElement;
    if (s.mode) root.setAttribute("data-theme", s.mode);
    else root.removeAttribute("data-theme");

    const dark = s.mode ? s.mode === "dark" : window.matchMedia("(prefers-color-scheme: dark)").matches;
    const accent = ACCENTS.find((a) => a.name === s.accent) ?? ACCENTS[0];
    const color = dark ? accent.dark : accent.light;
    const [r, g, b] = hexToRgb(color);

    root.style.setProperty("--accent", color);
    root.style.setProperty("--accent-2", color);
    root.style.setProperty("--accent-wash", `rgb(${r} ${g} ${b} / ${dark ? 0.16 : 0.1})`);
    root.style.setProperty("--accent-ink", dark ? "#06152B" : "#FFFFFF");
    root.style.setProperty("--density", s.density);
    root.style.setProperty("--radius", s.radius);
    const px = parseInt(s.radius, 10);
    root.style.setProperty("--radius-sm", px > 2 ? `${Math.max(4, px - 3)}px` : "2px");
    root.classList.toggle("reduce-motion", s.reduceMotion);
  }, []);

  useEffect(() => {
    apply(state);
    // The accent has a light and a dark variant, so a system theme flip has to
    // re-resolve it — not just swap the token block.
    const mq = window.matchMedia("(prefers-color-scheme: dark)");
    const onChange = () => apply(state);
    mq.addEventListener("change", onChange);
    return () => mq.removeEventListener("change", onChange);
  }, [state, apply]);

  const set = useCallback((patch: Partial<Appearance>) => {
    setState((prev) => {
      const next = { ...prev, ...patch };
      try {
        window.localStorage.setItem(KEY, JSON.stringify(next));
      } catch {
        /* storage blocked — the choice still applies for this session */
      }
      return next;
    });
  }, []);

  const reset = useCallback(() => {
    try {
      window.localStorage.removeItem(KEY);
    } catch {
      /* nothing to clean up */
    }
    setState(DEFAULT_APPEARANCE);
  }, []);

  const value = useMemo(() => ({ ...state, set, reset }), [state, set, reset]);
  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>;
}

export function useAppearance() {
  const ctx = useContext(ThemeContext);
  if (!ctx) throw new Error("useAppearance must be used inside <ThemeProvider>");
  return ctx;
}
