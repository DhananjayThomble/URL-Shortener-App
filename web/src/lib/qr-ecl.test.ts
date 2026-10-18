import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { QR_ECL_LEVELS, eclHelp } from "./qr-ecl";

/* #774 — the error-correction help text never changed, L + logo was silently raised to Q,
   and the dark foreground swatch was invisible on the dark theme.

   Oracles (none read from the implementation under test):
   - Recovery capacity: ISO/IEC 18004 Table 12 — L 7 %, M 15 %, Q 25 %, H 30 %.
   - The issue's acceptance criteria: help text describes the SELECTED level; logo + L is
     either raised or warned about (here: raised AND said so); swatches have a visible outline
     in both themes.
   - Swatch outline: WCAG 2.2 SC 1.4.11 non-text contrast, 3:1 against the surface behind it,
     computed here from the raw tokens in globals.css. */

describe("eclHelp — the help text describes the selected level", () => {
  const capacity = { L: "7%", M: "15%", Q: "25%", H: "30%" } as const;

  it("is different for every level and names its own level and recovery figure", () => {
    const texts = QR_ECL_LEVELS.map((l) => eclHelp(l, false).text);
    expect(new Set(texts).size).toBe(4);
    for (const l of QR_ECL_LEVELS) {
      const t = eclHelp(l, false).text;
      expect(t.startsWith(`${l} `), t).toBe(true);
      expect(t, t).toContain(capacity[l]);
      // No level's text may quote another level's figure.
      for (const other of QR_ECL_LEVELS) if (other !== l) expect(t, `${l} text vs ${other}`).not.toContain(capacity[other]);
    }
  });

  it("never claims L or M tolerate a centre logo (that is Q's text)", () => {
    expect(eclHelp("L", false).text).not.toMatch(/centre logo/i);
    expect(eclHelp("M", false).text).not.toMatch(/centre logo/i);
    expect(eclHelp("Q", false).text).toMatch(/centre logo/i);
  });

  it("does not depend on the logo toggle for the level description", () => {
    for (const l of QR_ECL_LEVELS) expect(eclHelp(l, true).text).toBe(eclHelp(l, false).text);
  });
});

describe("eclHelp — logo + low level is surfaced, not silent", () => {
  it("L and M with the logo on: raised to Q, with a notice naming both levels", () => {
    for (const l of ["L", "M"] as const) {
      const h = eclHelp(l, true);
      expect(h.raised).toBe(true);
      expect(h.effective).toBe("Q");
      expect(h.notice).toContain("Q");
      expect(h.notice).toContain(l);
      expect(h.notice).toMatch(/logo/i);
    }
  });

  it("L and M with the logo off: used as picked, no notice", () => {
    for (const l of ["L", "M"] as const) {
      const h = eclHelp(l, false);
      expect(h).toMatchObject({ raised: false, effective: l, notice: null });
    }
  });

  it("Q and H are never raised, logo or not", () => {
    for (const l of ["Q", "H"] as const)
      for (const logo of [true, false]) expect(eclHelp(l, logo)).toMatchObject({ raised: false, effective: l, notice: null });
  });
});

describe("foreground swatch outline — visible on every surface it can sit on, both themes", () => {
  const css = readFileSync(fileURLToPath(new URL("../app/globals.css", import.meta.url)), "utf8");

  const block = (marker: string) => {
    const start = css.indexOf(marker);
    if (start < 0) throw new Error(`marker not found: ${marker}`);
    const open = css.indexOf("{", start);
    let depth = 0;
    let i = open;
    for (; i < css.length; i++) {
      if (css[i] === "{") depth++;
      else if (css[i] === "}" && --depth === 0) break;
    }
    return css.slice(open, i + 1);
  };
  const v = (b: string, name: string) => {
    const m = new RegExp(`--${name}:\\s*(#[0-9a-fA-F]{6});`).exec(b);
    if (!m) throw new Error(`--${name} missing`);
    return m[1];
  };
  const lin = (c: number) => {
    const s = c / 255;
    return s <= 0.04045 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  };
  const lum = (hex: string) => {
    const [r, g, b] = [1, 3, 5].map((o) => parseInt(hex.slice(o, o + 2), 16));
    return 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b);
  };
  const ratio = (a: string, b: string) => {
    const [hi, lo] = lum(a) > lum(b) ? [lum(a), lum(b)] : [lum(b), lum(a)];
    return (hi + 0.05) / (lo + 0.05);
  };

  // The ring is drawn with the --ink-3 token (see qr/page.tsx).
  const themes = { light: block(":root {"), dark: block(':root[data-theme="dark"] {') };
  const SWATCHES = ["#0C1219", "#1F5FD4", "#0B6E80", "#5B4BC4"];

  for (const [name, b] of Object.entries(themes)) {
    it(`${name}: the ring clears 3:1 on every surface token`, () => {
      const ring = v(b, "ink-3");
      for (const s of ["ground", "surface", "surface-2", "surface-3", "surface-4"])
        expect(ratio(ring, v(b, s)), `ring ${ring} on ${s} ${v(b, s)}`).toBeGreaterThanOrEqual(3);
    });
  }

  it("the problem being fixed: the near-black swatch alone is < 3:1 on the dark card surface", () => {
    // Why a ring is needed at all.
    expect(ratio(SWATCHES[0], v(themes.dark, "surface"))).toBeLessThan(1.3);
  });
});
