import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

/* Regression test for #473: the warning chip (bg-wash-warn + text-amber) and
   the avatar-initials chip (bg-surface-4 + text-ink-3) measured below the
   WCAG 2.2 AA 4.5:1 floor (axe-core `color-contrast`, SC 1.4.3) in the light
   theme — 4.22:1 and 4.48:1 respectively. This is an independent oracle: it
   re-derives contrast from the raw token values in globals.css rather than
   trusting whatever the component renders, so a future edit to --amber,
   --ink-3, --wash-amber or the surface tokens that regresses below 4.5:1
   fails here instead of only showing up in an axe run against the live app. */

const cssPath = fileURLToPath(new URL("./globals.css", import.meta.url));
const css = readFileSync(cssPath, "utf8");

function readVar(block: string, name: string): string {
  const re = new RegExp(`--${name}:\\s*([^;]+);`);
  const match = block.match(re);
  if (!match) throw new Error(`--${name} not found in provided CSS block`);
  return match[1].trim();
}

function extractRootBlock(source: string): string {
  // The un-stamped `:root { ... }` block (light theme defaults). Grab the
  // first `:root {` occurrence, not `:root[data-theme="dark"]`.
  const start = source.indexOf(":root {");
  const braceStart = source.indexOf("{", start);
  let depth = 0;
  let i = braceStart;
  for (; i < source.length; i++) {
    if (source[i] === "{") depth++;
    else if (source[i] === "}") {
      depth--;
      if (depth === 0) break;
    }
  }
  return source.slice(braceStart, i + 1);
}

function srgbToLinear(c: number): number {
  const v = c / 255;
  return v <= 0.04045 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4);
}

function hexToRgb(hex: string): [number, number, number] {
  const n = hex.replace("#", "");
  return [parseInt(n.slice(0, 2), 16), parseInt(n.slice(2, 4), 16), parseInt(n.slice(4, 6), 16)];
}

function relativeLuminance(hex: string): number {
  const [r, g, b] = hexToRgb(hex);
  return 0.2126 * srgbToLinear(r) + 0.7152 * srgbToLinear(g) + 0.0722 * srgbToLinear(b);
}

/** WCAG 2.2 contrast ratio between two opaque sRGB hex colours. */
function contrastRatio(hexA: string, hexB: string): number {
  const lA = relativeLuminance(hexA);
  const lB = relativeLuminance(hexB);
  const [lighter, darker] = lA > lB ? [lA, lB] : [lB, lA];
  return (lighter + 0.05) / (darker + 0.05);
}

/** Flattens an `rgb(r g b / a)` colour over an opaque hex background. */
function flattenOverBackground(rgba: string, backgroundHex: string): string {
  const match = rgba.match(/rgb\((\d+)\s+(\d+)\s+(\d+)\s*\/\s*([\d.]+)\)/);
  if (!match) throw new Error(`unexpected colour format: ${rgba}`);
  const [, rs, gs, bs, as] = match;
  const [r, g, b, a] = [Number(rs), Number(gs), Number(bs), Number(as)];
  const [br, bg, bb] = hexToRgb(backgroundHex);
  const blend = (fg: number, bgChannel: number) => Math.round(fg * a + bgChannel * (1 - a));
  const out = [blend(r, br), blend(g, bg), blend(b, bb)];
  return "#" + out.map((v) => v.toString(16).padStart(2, "0")).join("");
}

const WCAG_AA_NORMAL_TEXT = 4.5;

describe("light-theme token contrast (WCAG 2.2 AA, SC 1.4.3)", () => {
  const root = extractRootBlock(css);

  it("warning chip (bg-wash-warn + text-amber) clears 4.5:1 on every surface it can sit on", () => {
    const amber = readVar(root, "amber");
    const washAmber = readVar(root, "wash-amber");
    // The chip sits on `surface`, but nested contexts (cards on surface-2,
    // panels on surface-3) also render it — check all three, as the original
    // finding was reproduced across routes with different ambient surfaces.
    for (const surfaceVar of ["surface", "surface-2", "surface-3"]) {
      const surfaceHex = readVar(root, surfaceVar);
      const blended = flattenOverBackground(washAmber, surfaceHex);
      const ratio = contrastRatio(blended, amber);
      expect(ratio, `amber on wash-amber over ${surfaceVar} (blended ${blended})`).toBeGreaterThanOrEqual(
        WCAG_AA_NORMAL_TEXT,
      );
    }
  });

  it("avatar-initials chip (bg-surface-4 + text-ink-3) clears 4.5:1", () => {
    const surface4 = readVar(root, "surface-4");
    const ink3 = readVar(root, "ink-3");
    expect(contrastRatio(surface4, ink3)).toBeGreaterThanOrEqual(WCAG_AA_NORMAL_TEXT);
  });

  it("text-ink-3 clears 4.5:1 against every surface token, not just the one it was tuned for", () => {
    const ink3 = readVar(root, "ink-3");
    for (const surfaceVar of ["ground", "surface", "surface-2", "surface-3", "surface-4"]) {
      const surfaceHex = readVar(root, surfaceVar);
      expect(
        contrastRatio(surfaceHex, ink3),
        `ink-3 (${ink3}) on ${surfaceVar} (${surfaceHex})`,
      ).toBeGreaterThanOrEqual(WCAG_AA_NORMAL_TEXT);
    }
  });
});
