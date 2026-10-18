import { devices, expect, test, type Locator, type Page } from "@playwright/test";
import { MOCK_USER, MOCK_WORKSPACE, fakeAccessToken, mockApi, seedMockSession } from "../support/mock-api";

/* E2E (#774): QR studio — error-correction help, the logo + low-level case, and the
   foreground swatches in both themes.

   Oracles (none read from the implementation):
   - ISO/IEC 18004 Table 12: L 7 %, M 15 %, Q 25 %, H 30 % recovery.
   - Issue #774 acceptance criteria: help text describes the SELECTED level; logo + L is
     raised or warned about; swatches have a visible outline in both themes.
   - WCAG 2.2 SC 1.4.11: a control's boundary needs 3:1 against what is behind it (computed
     here from the colours the browser actually painted, light AND dark); SC 1.4.3: 4.5:1 text.
   - "Raised" is checked on the symbol itself: with the logo on, the preview at L and at M is
     module-for-module the preview at Q (the lib is the only thing that can produce that). */

const SLUG = "limited";
const NOW = "2026-01-01T00:00:00.000Z";
const LINK = {
  id: "lnk_1",
  domain: "snap.to",
  slug: SLUG,
  destination: "https://example.com/start",
  tags: [] as string[],
  status: "active",
  clicks: 0,
  redirectType: "302",
  rules: [],
  passwordProtected: false,
  forwardQuery: true,
  deepLink: false,
  hideReferrer: false,
  publicPreview: true,
  cloaked: false,
  safeBrowsing: { status: "clean", checkedAt: NOW },
  sparkline: Array.from({ length: 30 }, () => 0),
  createdAt: NOW,
  clickLimit: null,
};

async function openStudio(page: Page) {
  await seedMockSession(page, fakeAccessToken(MOCK_WORKSPACE.id));
  await mockApi(page, {
    "GET /auth/me": { status: 200, body: MOCK_USER },
    "GET /auth/workspaces": {
      status: 200,
      body: [{ id: MOCK_WORKSPACE.id, name: MOCK_WORKSPACE.name, initials: MOCK_WORKSPACE.initials, role: "owner", current: true }],
    },
    "GET /workspaces/current": { status: 200, body: MOCK_WORKSPACE },
    "GET /domains": { status: 200, body: [] },
    "GET /members": { status: 200, body: [] },
    "GET /bio-pages": { status: 200, body: [] },
    "GET /links": { status: 200, body: { items: [LINK], total: 1, nextCursor: null } },
  });
  await page.goto("/qr");
  await expect(page.getByTestId("qr-preview").locator("svg")).toBeVisible();
}

const logoToggle = (page: Page) => page.getByRole("button", { name: /^Centre logo/ });
const eclGroup = (page: Page) => page.getByRole("group", { name: "Error correction" });
const help = (page: Page) => page.getByTestId("qr-ecl-help");
const notice = (page: Page) => page.getByTestId("qr-ecl-notice");
const swatch = (page: Page, hex: string) => page.getByRole("button", { name: `Foreground colour ${hex}` });

async function setLogo(page: Page, on: boolean) {
  const t = logoToggle(page);
  if ((await t.getAttribute("aria-pressed")) !== String(on)) await t.click();
  await expect(t).toHaveAttribute("aria-pressed", String(on));
}
async function setEcl(page: Page, ecl: "L" | "M" | "Q" | "H") {
  const b = eclGroup(page).getByRole("button", { name: ecl, exact: true });
  await b.click();
  await expect(b).toHaveAttribute("aria-pressed", "true");
}
/** The module pattern of the preview (the dark-cell path), independent of colours. */
const modules = (page: Page) =>
  page.evaluate(() => document.querySelectorAll('[data-testid="qr-preview"] svg path')[1]?.getAttribute("d") ?? "");

/* ---- colour maths, from painted pixels' colours ---- */
type RGBA = [number, number, number, number];
const parse = (c: string): RGBA => {
  const m = /rgba?\(([^)]+)\)/.exec(c);
  if (!m) throw new Error(`unparseable colour: ${c}`);
  const p = m[1].split(/[\s,/]+/).filter(Boolean).map(Number);
  return [p[0], p[1], p[2], p[3] ?? 1];
};
const lin = (v: number) => {
  const s = v / 255;
  return s <= 0.04045 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
};
const lum = ([r, g, b]: RGBA) => 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b);
const ratio = (a: RGBA, b: RGBA) => {
  const [hi, lo] = lum(a) > lum(b) ? [lum(a), lum(b)] : [lum(b), lum(a)];
  return (hi + 0.05) / (lo + 0.05);
};

/** The colour actually behind an element: first ancestor with an opaque-ish background. */
async function surfaceBehind(el: Locator): Promise<RGBA> {
  const css = await el.evaluate((node) => {
    for (let n = node.parentElement; n; n = n.parentElement) {
      const bg = getComputedStyle(n).backgroundColor;
      const m = /rgba?\(([^)]+)\)/.exec(bg);
      const a = m ? (m[1].split(/[\s,/]+/).filter(Boolean).map(Number)[3] ?? 1) : 0;
      if (a > 0.95) return bg;
    }
    return "rgb(255, 255, 255)";
  });
  return parse(css);
}
const paint = (el: Locator, prop: string) => el.evaluate((n, p) => getComputedStyle(n).getPropertyValue(p), prop).then(parse);

const { defaultBrowserType: _ignored, ...pixel7 } = devices["Pixel 7"];
const viewports = [
  { name: "desktop", use: { viewport: { width: 1280, height: 800 } } },
  { name: "mobile (Pixel 7, 412px)", use: pixel7 },
] as const;

for (const vp of viewports) {
  for (const scheme of ["light", "dark"] as const) {
    test.describe(`QR studio ECL help + swatches — ${vp.name}, ${scheme} theme`, () => {
      test.use({ ...vp.use, colorScheme: scheme });

      test("the help text changes with the selected level and is the field's accessible description", async ({ page }) => {
        await openStudio(page);
        await setLogo(page, false);
        const seen: Record<string, string> = {};
        const figure = { L: "7%", M: "15%", Q: "25%", H: "30%" } as const;
        for (const l of ["L", "M", "Q", "H"] as const) {
          await setEcl(page, l);
          const text = (await help(page).textContent()) ?? "";
          seen[l] = text;
          expect(text, `${l}: names its own level`).toMatch(new RegExp(`^${l} `));
          expect(text, `${l}: gives its own recovery figure`).toContain(figure[l]);
          // The group's accessible description is that same text (aria-describedby wired).
          await expect(eclGroup(page)).toHaveAccessibleDescription(new RegExp(`^${l} recovers about ${figure[l]}`));
        }
        expect(new Set(Object.values(seen)).size, "four distinct texts").toBe(4);
        expect(seen.L).not.toMatch(/centre logo/i);
        expect(seen.M).not.toMatch(/centre logo/i);
        expect(seen.Q).toMatch(/centre logo/i);
      });

      test("logo + L (and M) is raised to Q on the symbol AND said so; logo off removes the notice", async ({ page }) => {
        await openStudio(page);
        await setLogo(page, true);
        await setEcl(page, "Q");
        const atQ = await modules(page);
        await expect(notice(page)).toBeEmpty();

        for (const l of ["L", "M"] as const) {
          await setEcl(page, l);
          await expect(notice(page), `${l}: warns`).toContainText(`generated at Q`);
          await expect(notice(page)).toContainText(l);
          expect(await modules(page), `${l} + logo draws the Q symbol`).toBe(atQ);
          // The notice is part of the field's accessible description.
          await expect(eclGroup(page)).toHaveAccessibleDescription(/generated at Q/);
          // Readable on the card (SC 1.4.3).
          const r = ratio(await paint(notice(page), "color"), await surfaceBehind(notice(page)));
          expect(r, `${l}: notice contrast ${r.toFixed(2)}:1 in ${scheme}`).toBeGreaterThanOrEqual(4.5);

          await setLogo(page, false);
          await expect(notice(page), `${l}: logo off, no notice`).toBeEmpty();
          expect(await modules(page), `${l} without logo is a genuinely lower level`).not.toBe(atQ);
          await setLogo(page, true);
          await expect(notice(page)).toContainText("generated at Q");
        }

        for (const l of ["Q", "H"] as const) {
          await setEcl(page, l);
          await expect(notice(page), `${l}: never raised`).toBeEmpty();
        }
      });

      test("every foreground swatch has an outline that is visible against the card, selected or not", async ({ page }) => {
        await openStudio(page);
        for (const hex of ["#0C1219", "#1F5FD4", "#0B6E80", "#5B4BC4"]) {
          // Select a different swatch first so `hex` is rendered in its UNselected state, then check both states.
          await swatch(page, hex === "#1F5FD4" ? "#0C1219" : "#1F5FD4").click();
          const s = swatch(page, hex);
          const behind = await surfaceBehind(s);

          const idleBorder = await paint(s, "border-top-color");
          expect(await s.evaluate((n) => getComputedStyle(n).borderTopWidth), `${hex}: has a border`).not.toBe("0px");
          const idle = ratio(idleBorder, behind);
          expect(idle, `${hex} unselected outline ${idle.toFixed(2)}:1 in ${scheme}`).toBeGreaterThanOrEqual(3);

          await s.click();
          await expect(s).toHaveAttribute("aria-pressed", "true");
          const selBorder = await paint(s, "border-top-color");
          expect(ratio(selBorder, behind), `${hex} selected outline in ${scheme}`).toBeGreaterThanOrEqual(3);
          // Selected is distinguishable without colour: it carries an extra ring.
          const ring = await s.evaluate((n) => getComputedStyle(n).boxShadow);
          expect(ring, `${hex}: selected has a ring`).not.toBe("none");
          const idleRing = await swatch(page, hex === "#1F5FD4" ? "#0C1219" : "#1F5FD4").evaluate((n) => getComputedStyle(n).boxShadow);
          expect(idleRing, "an unselected swatch has no ring").toBe("none");
        }
      });

      test("picking a swatch still recolours the preview", async ({ page }) => {
        await openStudio(page);
        await swatch(page, "#5B4BC4").click();
        await expect
          .poll(() => page.evaluate(() => document.querySelectorAll('[data-testid="qr-preview"] svg path')[1]?.getAttribute("stroke")?.toLowerCase()))
          .toBe("#5b4bc4");
      });
    });
  }
}

test.describe("explicit data-theme=dark (Settings → Appearance), light system scheme", () => {
  test.use({ colorScheme: "light", viewport: { width: 1280, height: 800 } });
  test("the near-black swatch keeps a ≥3:1 outline against the dark card", async ({ page }) => {
    await openStudio(page);
    await page.evaluate(() => document.documentElement.setAttribute("data-theme", "dark"));
    const s = swatch(page, "#0C1219");
    await swatch(page, "#1F5FD4").click();
    const behind = await surfaceBehind(s);
    expect(lum(behind), "the card really is dark").toBeLessThan(0.05);
    expect(ratio(await paint(s, "border-top-color"), behind)).toBeGreaterThanOrEqual(3);
  });
});
