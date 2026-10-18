/**
 * Journey 774 — QR studio: error-correction help, logo + low level, swatch outline (real stack)
 *
 * A real account and a real link created through the API; the studio is driven the way a
 * user drives it. Every assertion is on an observable effect after a real click:
 *   - the help text names the SELECTED level (ISO/IEC 18004 Table 12 recovery figure);
 *   - logo + L/M → the notice appears and the symbol on screen is the Q symbol;
 *   - the foreground swatch outlines clear WCAG 1.4.11 (3:1) against the card in light AND dark.
 * The mocked-api lane (e2e/mocked-api/qr-ecl-help.spec.ts) covers the matrix; this proves the
 * same on the live API + real session. Titles carry @mobile so the Pixel project runs them too.
 *
 * Set QA_SHOT_DIR to also write screenshots there (evidence only; nothing is asserted on them).
 */

import path from "node:path";
import { expect, test, type Locator, type Page } from "@playwright/test";
import { createLink, makeEmail, registerUser, seedAccount } from "./helpers";

const SHOTS = process.env.QA_SHOT_DIR;

const eclGroup = (p: Page) => p.getByRole("group", { name: "Error correction" });
const swatch = (p: Page, hex: string) => p.getByRole("button", { name: `Foreground colour ${hex}` });
const modules = (p: Page) =>
  p.evaluate(() => document.querySelectorAll('[data-testid="qr-preview"] svg path')[1]?.getAttribute("d") ?? "");

type RGB = [number, number, number];
const parse = (c: string): RGB => {
  const m = /rgba?\(([^)]+)\)/.exec(c)!;
  const n = m[1].split(/[\s,/]+/).filter(Boolean).map(Number);
  return [n[0], n[1], n[2]];
};
const lin = (v: number) => ((v / 255) <= 0.04045 ? v / 255 / 12.92 : ((v / 255 + 0.055) / 1.055) ** 2.4);
const lum = ([r, g, b]: RGB) => 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b);
const ratio = (a: RGB, b: RGB) => {
  const [hi, lo] = lum(a) > lum(b) ? [lum(a), lum(b)] : [lum(b), lum(a)];
  return (hi + 0.05) / (lo + 0.05);
};
const surfaceBehind = (el: Locator) =>
  el.evaluate((node) => {
    for (let n = node.parentElement; n; n = n.parentElement) {
      const bg = getComputedStyle(n).backgroundColor;
      const m = /rgba?\(([^)]+)\)/.exec(bg);
      const a = m ? (m[1].split(/[\s,/]+/).filter(Boolean).map(Number)[3] ?? 1) : 0;
      if (a > 0.95) return bg;
    }
    return "rgb(255, 255, 255)";
  }).then(parse);

for (const scheme of ["light", "dark"] as const) {
  test.describe(`J774 QR studio — ${scheme} theme`, () => {
    test.use({ colorScheme: scheme });

    test(`@mobile help follows the level, logo raises L/M with a notice, swatches are outlined (${scheme})`, async ({ page }, info) => {
      const session = await registerUser(makeEmail(`j774-${scheme}`));
      await createLink(session.accessToken, { destination: "https://example.com/j774" });
      await seedAccount(page, session);
      await page.goto("/qr");
      await expect(page.getByTestId("qr-preview").locator("svg")).toBeVisible();

      const shot = async (name: string) => {
        if (SHOTS) await page.screenshot({ path: path.join(SHOTS, `${info.project.name}-${scheme}-${name}.png`), fullPage: true });
      };

      // Help text describes the picked level.
      const figure = { L: "7%", M: "15%", Q: "25%", H: "30%" } as const;
      const logo = page.getByRole("button", { name: /^Centre logo/ });
      if ((await logo.getAttribute("aria-pressed")) === "true") await logo.click();
      for (const l of ["L", "M", "Q", "H"] as const) {
        await eclGroup(page).getByRole("button", { name: l, exact: true }).click();
        await expect(page.getByTestId("qr-ecl-help")).toContainText(`${l} recovers about ${figure[l]}`);
      }

      // Logo on + L: raised to Q and said so; the symbol is the Q symbol.
      await eclGroup(page).getByRole("button", { name: "Q", exact: true }).click();
      await logo.click();
      await expect(logo).toHaveAttribute("aria-pressed", "true");
      const atQ = await modules(page);
      await expect(page.getByTestId("qr-ecl-notice")).toBeEmpty();
      await eclGroup(page).getByRole("button", { name: "L", exact: true }).click();
      await expect(page.getByTestId("qr-ecl-notice")).toContainText("generated at Q");
      expect(await modules(page)).toBe(atQ);
      await shot("logo-on-L");
      await logo.click();
      await expect(page.getByTestId("qr-ecl-notice")).toBeEmpty();
      expect(await modules(page)).not.toBe(atQ);

      // Swatches: visible outline against the actual card, both states.
      await swatch(page, "#1F5FD4").click();
      const dark = swatch(page, "#0C1219");
      const behind = await surfaceBehind(dark);
      const r = ratio(parse(await dark.evaluate((n) => getComputedStyle(n).borderTopColor)), behind);
      expect(r, `near-black swatch outline ${r.toFixed(2)}:1 on the card (${scheme})`).toBeGreaterThanOrEqual(3);
      await shot("swatches");
    });
  });
}
