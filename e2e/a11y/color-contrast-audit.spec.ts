import AxeBuilder from "@axe-core/playwright";
import { type Page } from "@playwright/test";
// Issue #884: one registration per worker, not per test. The worker-scoped
// `workerSession` / `workerLink` fixtures and the `seedWorker` helper come from
// a11y-fixtures.ts; `test`/`expect` are re-exported from there so every test in
// this file gets the worker fixtures without changing how assertions are
// written. `seedWorker` replaces the former per-test `seedSession` call.
import { expect, seedWorker, test } from "./a11y-fixtures";

/* ============================================================
   Issue #558 — dark-theme WCAG AA color-contrast audit (axe `color-contrast`).
   Split from #438 (first accessibility audit, run 2026-09-15): every
   dark-theme combination in that run had at least one `color-contrast`
   failure (36 nodes total), while every light-theme combination scored zero.

   A re-check against main on 2026-09-21 (see #558's own comment thread) found
   0 violations on all 11 static routes, dark theme, DESKTOP viewport only —
   but explicitly flagged a coverage gap: mobile viewport, the create-link
   drawer, and the dynamic /links/:id page were never re-scanned for
   color-contrast. This suite closes that gap and becomes the durable
   regression guard the issue's acceptance criteria ask for ("re-running the
   same axe scan ... shows 0 color-contrast violations"), rather than a
   one-off scratch spec whose result evaporates.

   Oracle: axe-core's own `color-contrast` rule (WCAG 2.1 AA: 4.5:1 normal
   text, 3:1 large text), run against the REAL staging backend per
   .kiro/steering/qa-oracles.md §1/§5. Not a judgement call.

   Structure mirrors label-audit.spec.ts (#459) deliberately: same ROUTES,
   VIEWPORTS, THEMES and theme-seeding mechanism, same real-backend wiring via
   playwright.a11y.config.ts. Only the axe rule set and the assertion differ.

   --- What this scans ---
   Per (viewport × theme) combination (4 combinations: {desktop,mobile} ×
   {light,dark}): 11 static (app) route tests, plus one create-link-drawer
   test that walks all 6 tabs within a single Playwright test, plus one
   dynamic /links/[id] edit-drawer test — 13 Playwright tests per
   combination. Dark is the regression target; light is carried along as a
   regression guard per the issue's third acceptance-criteria bullet ("light
   theme is not regressed").
   Total = 13 × 4 = 52 Playwright tests (each drawer test additionally asserts
   6 times internally, once per tab, but that is not a separate test).

   --- Coverage gaps (qa-oracles §3 requires stating these) ---
   · Auth routes (/login, /register, /2fa, /forgot) are outside (app) and are
     NOT scanned here, matching label-audit.spec.ts's own scope.
   · Modals/menus that only open on a specific row action beyond the
     create-link drawer are not exhaustively opened.
   · Chromium only; no forced-colors/high-contrast/reduced-motion variants.
   · axe's color-contrast rule cannot evaluate text painted over a
     background-image or a gradient it cannot sample reliably — those nodes
     surface as "incomplete", not "violations", and are not asserted on here.

   --- CI does NOT run this suite ---
   Same as label-audit.spec.ts: nothing in .github/workflows/, the root
   package.json or e2e/package.json references playwright.a11y.config.ts or
   e2e/a11y. This is a manual QA-lab suite, run against a live staging stack.
   ============================================================ */

const RULES = ["color-contrast"];

const ROUTES = [
  "/links",
  "/analytics",
  "/conversions",
  "/forms",
  "/bio",
  "/qr",
  "/domains",
  "/developers",
  "/team",
  "/reports",
  "/settings",
];

const VIEWPORTS = [
  { name: "desktop", width: 1280, height: 900 },
  { name: "mobile", width: 390, height: 844 },
] as const;

const THEMES = ["light", "dark"] as const;

/** Force a theme before the app boots — the pre-paint script in app/layout.tsx
 *  reads localStorage["snapurl.appearance"].mode and sets data-theme from it. */
async function seedTheme(page: Page, mode: (typeof THEMES)[number]): Promise<void> {
  await page.addInitScript(
    ([key, m]) => window.localStorage.setItem(key, JSON.stringify({ mode: m })),
    ["snapurl.appearance", mode] as const,
  );
}

function runAxe(page: Page) {
  return new AxeBuilder({ page }).withRules(RULES).analyze();
}

/** Flatten axe violation nodes into a compact, greppable list for the report. */
function summarise(violations: Awaited<ReturnType<typeof runAxe>>["violations"]) {
  return violations.flatMap((v) =>
    v.nodes.map((n) => ({ rule: v.id, target: n.target.join(" "), html: n.html.slice(0, 200) })),
  );
}

for (const theme of THEMES) {
  for (const vp of VIEWPORTS) {
    test.describe(`${theme} / ${vp.name}`, () => {
      test.use({ viewport: { width: vp.width, height: vp.height } });

      test.beforeEach(async ({ page, workerSession }) => {
        await seedTheme(page, theme);
        // #884: reuse the worker's single registration instead of minting a
        // fresh account per test (the former seedSession → registerRealUser).
        await seedWorker(page, workerSession);
      });

      for (const route of ROUTES) {
        test(`${route} has no color-contrast violations`, async ({ page }) => {
          await page.goto(route);
          await page.waitForLoadState("networkidle").catch(() => {});
          const { violations } = await runAxe(page);
          expect(summarise(violations), JSON.stringify(summarise(violations), null, 2)).toEqual([]);
        });
      }

      test("create-link drawer has no color-contrast violations", async ({ page }) => {
        await page.goto("/links");
        await page.waitForLoadState("networkidle").catch(() => {});
        await page
          .getByRole("button", { name: /New link|Create a link/ })
          .first()
          .click();
        const drawer = page.getByRole("dialog", { name: "Create a link" });
        await expect(drawer).toBeVisible();
        // Walk every tab so each panel's controls are mounted and scanned.
        for (const tabName of ["Destination", "Routing", "Access", "UTM", "Social preview", "QR"]) {
          await drawer.getByRole("tab", { name: tabName }).click();
          const { violations } = await runAxe(page);
          const found = summarise(violations);
          expect(found, `tab "${tabName}": ${JSON.stringify(found, null, 2)}`).toEqual([]);
        }
      });

      test("/links/[id] edit drawer has no color-contrast violations", async ({ page, workerSession, workerLink }) => {
        // Dynamic route: scan the actually-rendered edit drawer for a real
        // link. #884: the link and session come from the worker-scoped fixtures
        // (one link + one registration per worker) rather than a fresh
        // per-test registerRealUser()/createRealLink() pair. The beforeEach
        // already seeded workerSession's tokens; re-seed here is harmless but
        // the shared fixtures make the account and link identical to it.
        // The edit drawer (#644 — EditLinkDrawer) replaced the old
        // destination-only Field; "Edit" now opens the same tabbed form the
        // create-link drawer uses.
        const link = workerLink;

        await page.goto(`/links/${link.id}`);
        await page.waitForLoadState("networkidle").catch(() => {});
        await page.getByRole("button", { name: "Edit", exact: true }).first().click();
        await expect(page.getByRole("textbox", { name: "Destination URL", exact: true })).toBeVisible();

        const { violations } = await runAxe(page);
        const found = summarise(violations);
        expect(found, JSON.stringify(found, null, 2)).toEqual([]);
      });
    });
  }
}
