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

function extractDarkBlock(source: string): string {
  // The explicit `:root[data-theme="dark"] { ... }` block. Deliberately not
  // the `@media (prefers-color-scheme: dark)` block, which duplicates the
  // same values — checking one is sufficient since a future edit to the
  // token values would have to touch both to stay in sync, and if it
  // doesn't, that is a separate finding from contrast.
  const marker = ':root[data-theme="dark"] {';
  const start = source.indexOf(marker);
  if (start === -1) throw new Error(`marker not found: ${marker}`);
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

/* Regression test for #497 item 2: the #496/#473 guard above only checked
   wash-amber (3 surfaces) and the ink-3/surface-4 pair. Measuring the full
   matrix -- every wash token paired with its text token, composited over
   every one of the five surface tokens, in both themes -- found it is wider
   than reported: wash-green (worst 3.72:1 on surface-4, light), wash-teal
   (4.08:1, surface-4, light), accent-wash (4.37:1, surface-4, light; and
   4.44:1 on surface-4 in DARK theme too -- the only dark-theme miss), and
   wash-amber itself was still short on surface-4 specifically (4.44:1) even
   though the 3-surface check above passes. wash-red cleared 4.5:1
   everywhere already. These are "latent" in the sense that axe-core does
   not flag them on any route today (the affected chips currently render on
   `surface`, where each pair happens to pass) -- but they are exactly the
   token-level guarantee this file exists to make, so the matrix is checked
   directly rather than waiting for a chip to be nested on surface-3/
   surface-4 in a future layout change. See #497. */
describe("wash-tokens paired with their text tokens clear 4.5:1 on every surface, both themes (#497)", () => {
  const root = extractRootBlock(css);
  const dark = extractDarkBlock(css);

  const pairs: Array<[string, string]> = [
    ["green", "wash-green"],
    ["teal", "wash-teal"],
    ["accent", "accent-wash"],
    ["amber", "wash-amber"],
    ["red", "wash-red"],
  ];
  const surfaceVars = ["ground", "surface", "surface-2", "surface-3", "surface-4"];

  for (const [label, block] of [["light", root], ["dark", dark]] as const) {
    for (const [textVar, washVar] of pairs) {
      it(`${label}: text-${textVar} on bg-${washVar} clears 4.5:1 over every surface`, () => {
        const text = readVar(block, textVar);
        const wash = readVar(block, washVar);
        for (const surfaceVar of surfaceVars) {
          const surfaceHex = readVar(block, surfaceVar);
          const blended = flattenOverBackground(wash, surfaceHex);
          const ratio = contrastRatio(blended, text);
          expect(
            ratio,
            `${label}: ${textVar} (${text}) on ${washVar} over ${surfaceVar} (blended ${blended})`,
          ).toBeGreaterThanOrEqual(WCAG_AA_NORMAL_TEXT);
        }
      });
    }
  }
});

/* Regression test for #462: the workspace-switcher badge (desktop sidebar +
   mobile nav drawer) and the account-menu avatar paired a literal
   `text-white` with `bg-violet` / `bg-teal`. --violet and --teal are
   *lightened* in dark theme for their primary use as text-on-surface (a
   chip's `text-teal`, a chart line's `text-violet`), which makes them too
   light to host white text on top — 2.76:1 and 2.23:1, both well under
   4.5:1. Light theme was fine (6.46:1, 5.91:1) because there --violet/--teal
   are still dark enough; that asymmetry is exactly why this surfaced as a
   dark-theme-only defect. --accent-ink already exists as a themed
   near-black/near-white pair for ink-on-saturated-bg (the accent-badge case
   right next to these in app-shell) and clears 4.5:1 against both violet and
   teal in both themes, so the fix reuses it instead of inventing a new
   token. */
describe("saturated-tone badges use --accent-ink, not a literal white, for their ink (#462)", () => {
  const root = extractRootBlock(css);
  const dark = extractDarkBlock(css);

  it("text-accent-ink on bg-violet clears 4.5:1 in both themes", () => {
    for (const [label, block] of [["light", root], ["dark", dark]] as const) {
      const violet = readVar(block, "violet");
      const accentInk = readVar(block, "accent-ink");
      expect(contrastRatio(violet, accentInk), `${label}: accent-ink (${accentInk}) on violet (${violet})`).toBeGreaterThanOrEqual(
        WCAG_AA_NORMAL_TEXT,
      );
    }
  });

  it("text-accent-ink on bg-teal clears 4.5:1 in both themes", () => {
    for (const [label, block] of [["light", root], ["dark", dark]] as const) {
      const teal = readVar(block, "teal");
      const accentInk = readVar(block, "accent-ink");
      expect(contrastRatio(teal, accentInk), `${label}: accent-ink (${accentInk}) on teal (${teal})`).toBeGreaterThanOrEqual(
        WCAG_AA_NORMAL_TEXT,
      );
    }
  });

  it("app-shell no longer pairs a literal text-white with bg-violet or bg-teal", () => {
    const appShellPath = fileURLToPath(new URL("../components/app-shell/index.tsx", import.meta.url));
    const source = readFileSync(appShellPath, "utf8");
    expect(source).not.toMatch(/bg-(violet|teal)\b[^"]*\btext-white\b/);
    expect(source).not.toMatch(/\btext-white\b[^"]*bg-(violet|teal)\b/);
  });

  /* #462 review on PR #515: the original patch only fixed app-shell's two
     badge instances. /team's member-avatar (AVATAR_TONES: bg-accent,
     bg-teal, bg-violet, bg-amber, bg-good) reused the same literal
     text-white-on-saturated-bg mistake and was missed — axe-core measured
     five serious nodes there in dark theme (accent 2.41, teal 2.23, violet
     2.76, amber 2.12, good 1.84), all under 4.5:1. --accent-ink clears
     4.5:1 against every one of those five tones in both themes (proven for
     violet/teal above; accent/amber/good proven below), so the fix is the
     same token swap, not a new one. */
  it("text-accent-ink on bg-accent clears 4.5:1 in both themes", () => {
    for (const [label, block] of [["light", root], ["dark", dark]] as const) {
      const accent = readVar(block, "accent");
      const accentInk = readVar(block, "accent-ink");
      expect(contrastRatio(accent, accentInk), `${label}: accent-ink (${accentInk}) on accent (${accent})`).toBeGreaterThanOrEqual(
        WCAG_AA_NORMAL_TEXT,
      );
    }
  });

  it("text-accent-ink on bg-amber clears 4.5:1 in both themes", () => {
    for (const [label, block] of [["light", root], ["dark", dark]] as const) {
      const amber = readVar(block, "amber");
      const accentInk = readVar(block, "accent-ink");
      expect(contrastRatio(amber, accentInk), `${label}: accent-ink (${accentInk}) on amber (${amber})`).toBeGreaterThanOrEqual(
        WCAG_AA_NORMAL_TEXT,
      );
    }
  });

  it("text-accent-ink on bg-good (--green) clears 4.5:1 in both themes", () => {
    for (const [label, block] of [["light", root], ["dark", dark]] as const) {
      // bg-good resolves to --color-good, which is var(--green) — see
      // globals.css's @theme block.
      const good = readVar(block, "green");
      const accentInk = readVar(block, "accent-ink");
      expect(contrastRatio(good, accentInk), `${label}: accent-ink (${accentInk}) on good/green (${good})`).toBeGreaterThanOrEqual(
        WCAG_AA_NORMAL_TEXT,
      );
    }
  });

  it("/team member-avatar no longer pairs a literal text-white with an AVATAR_TONES background", () => {
    const teamPagePath = fileURLToPath(new URL("./(app)/team/page.tsx", import.meta.url));
    const source = readFileSync(teamPagePath, "utf8");
    expect(source).toMatch(/AVATAR_TONES\s*=\s*\[/);
    expect(source).not.toMatch(/\btext-white\b/);
  });
});

/* Regression test for #497 item 1: /bio's "Powered by SnapURL" caption combined
   text-ink-3 with opacity-70. --ink-3 alone clears 4.5:1 (proven above), but
   opacity-70 composited it down to an effective #87909a against --ground —
   2.85:1, an axe-core `serious` color-contrast violation. Tailwind's opacity
   utilities are invisible to the token-level oracle above (they don't touch
   globals.css), so this needs its own, independent check: an opacity utility
   class must never be paired with an ink/wash token in the source, because
   the resulting composited colour cannot be predicted from the token alone.

   This source-scan cannot see every equivalent regression (an arbitrary-value
   opacity-[0.7] and the colour-alpha modifier text-ink-3/70 both reproduce the
   identical composite while dodging a naive `opacity-\d+` match or a plain
   `.toContain("text-ink-3")` check) — see PR #500 review. The rendered-property
   check that closes that gap lives in e2e/tests/bio.spec.ts (axe-core
   color-contrast against the real fixtures build); this test stays as a fast,
   source-level tripwire for the literal defect, not the sole guard. */
describe("bio page 'Powered by SnapURL' caption (#497)", () => {
  const bioPagePath = fileURLToPath(
    new URL("./(app)/bio/page.tsx", import.meta.url),
  );
  const source = readFileSync(bioPagePath, "utf8");

  it("does not pair an opacity utility or an alpha-modified ink token with the caption", () => {
    const match = source.match(/<div className="([^"]*)">Powered by SnapURL<\/div>/);
    expect(match, "expected to find the 'Powered by SnapURL' caption element").not.toBeNull();
    const classes = match![1];
    expect(classes).toContain("text-ink-3");
    // Named-scale (opacity-70) and arbitrary-value (opacity-[0.7]) utilities.
    expect(classes).not.toMatch(/\bopacity-(\d+\b|\[[^\]]+\])/);
    // Colour-alpha modifier on the ink token itself (text-ink-3/70).
    expect(classes).not.toMatch(/\btext-ink-3\/\d+\b/);
  });
});

/* Regression test for #462: the "What each role can do" permissions matrix on
   /team paired text-ink-3 with opacity-50 on the "not allowed" glyph ("—").
   --ink-3 alone clears 4.5:1 in both themes (proven above), but opacity-50
   composites it down to ~2.0-2.5:1 against every surface token in both light
   and dark — an axe-core `serious` color-contrast violation on real,
   information-bearing text (it is how a viewer tells "denied" from "granted"
   in the matrix), not decoration. This is the same defect class as #497's
   bio caption: an opacity utility composited with an ink/wash token produces
   a colour the token-level oracle above cannot see, because it never touches
   globals.css.

   Scoped as a repo-wide source scan (not just team/page.tsx) because #462's
   premise is that this is systematic, not a single instance — the same
   opacity+ink-token mistake could recur in any component. Extend the
   `SAFE_OPACITY_CONTEXTS` allowlist below only for opacity utilities that are
   provably not composited with an ink/wash/accent/status token as visible
   text (e.g. a fully decorative icon glyph marked aria-hidden, or a hidden/
   visible toggle between 0 and 100). */
describe("no ink/status token is composited with a bare opacity utility (#462)", () => {
  const webSrcDir = fileURLToPath(new URL(".", import.meta.url));
  const appDir = path.join(webSrcDir); // web/src/app

  function walk(dir: string): string[] {
    const out: string[] = [];
    for (const entry of require("node:fs").readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) out.push(...walk(full));
      else if (entry.name.endsWith(".tsx")) out.push(full);
    }
    return out;
  }

  // text/status tokens whose contrast is only proven at full opacity (the
  // globals-contrast.test.ts suite above never checks a partial-alpha
  // composite, because Tailwind opacity utilities don't touch globals.css).
  const TOKEN_CLASS = /\btext-(ink|ink-2|ink-3|amber|good|bad|teal|violet|accent|accent-2)\b/;
  // A bare numeric or arbitrary-value opacity utility that is not a 0/100
  // visibility toggle (those are fully transparent or fully opaque, never a
  // partial composite) and not a `disabled:` / `hover:` / `focus-visible:`
  // conditional low-opacity dim on an already-disabled or transient state.
  const BARE_OPACITY_CLASS = /(?<!hover:|disabled:|focus-visible:|group-hover:)\bopacity-(?!0\b|100\b)(\d+|\[[^\]]+\])/;

  const files = walk(appDir).concat(
    walk(fileURLToPath(new URL("../components", import.meta.url))),
  );

  it("has no component pairing a text/status token with a partial, non-toggle opacity utility", () => {
    const offenders: string[] = [];
    // Scan every quoted string literal in the file, not just a literal
    // `className="..."` attribute — Tailwind class lists routinely live
    // inside a `cn(...)` call with conditional branches
    // (`cn("text-center", allowed ? "text-good" : "text-ink-3 opacity-50")`),
    // so the class string is one arm of a ternary, not the whole attribute
    // value. Matching only `className="..."` misses exactly that shape,
    // which is the shape the real #462 defect took.
    const STRING_LITERAL = /["'`]([^"'`\n]*)["'`]/g;
    for (const file of files) {
      const src = readFileSync(file, "utf8");
      for (const litMatch of src.matchAll(STRING_LITERAL)) {
        const literal = litMatch[1];
        if (TOKEN_CLASS.test(literal) && BARE_OPACITY_CLASS.test(literal)) {
          offenders.push(`${path.relative(webSrcDir, file)}: "${literal}"`);
        }
      }
    }
    expect(offenders, offenders.join("\n")).toEqual([]);
  });
});
