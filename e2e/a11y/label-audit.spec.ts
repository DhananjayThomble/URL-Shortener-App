import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";
import { seedSession } from "../support/session";

/* ============================================================
   Issue #459 — programmatic-label audit (axe `label` + `select-name`).

   Oracle: axe-core's own `label` and `select-name` rules (WCAG 2.1 SC 4.1.2 /
   1.3.1). Not a judgement call — a form control either has a programmatically
   associated accessible name or it does not.

   Runs against the REAL staging stack (playwright.a11y.config.ts builds web with
   NEXT_PUBLIC_USE_FIXTURES=false, pointed at api :3001). qa-oracles §5 forbids
   QA against fixtures; the markup an axe rule inspects is produced by the React
   components regardless of the data source, but running real keeps this audit
   honest and identical to the run that first filed #438.

   Coverage: every (app) route that renders a form or a filter control, plus the
   create-link drawer (its `Field` inputs were the specific `label`-rule nodes in
   #438) — across two viewports (1280 / 390) and two themes (light / dark).
   ============================================================ */

const RULES = ["label", "select-name"];

const ROUTES = [
  "/links",
  "/links/new", // not a real route; the drawer opens on /links — see the drawer block below
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
].filter((r) => r !== "/links/new");

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

      test.beforeEach(async ({ page }) => {
        await seedTheme(page, theme);
        await seedSession(page);
      });

      for (const route of ROUTES) {
        test(`${route} has no label/select-name violations`, async ({ page }) => {
          await page.goto(route);
          // Let the route-guarded page settle before scanning.
          await page.waitForLoadState("networkidle").catch(() => {});
          const { violations } = await runAxe(page);
          expect(summarise(violations), JSON.stringify(summarise(violations), null, 2)).toEqual([]);
        });
      }

      test("create-link drawer has no label/select-name violations", async ({ page }) => {
        await page.goto("/links");
        await page.waitForLoadState("networkidle").catch(() => {});
        await page
          .getByRole("button", { name: /New link|Create a link/ })
          .first()
          .click();
        const drawer = page.getByRole("dialog", { name: "Create a link" });
        await expect(drawer).toBeVisible();
        // Walk every tab so each panel's controls are mounted and scanned — the
        // drawer renders one tab at a time.
        for (const tabName of ["Destination", "Routing", "Access", "UTM", "Social preview", "QR"]) {
          await drawer.getByRole("button", { name: tabName }).click();
          const { violations } = await runAxe(page);
          const found = summarise(violations);
          expect(found, `tab "${tabName}": ${JSON.stringify(found, null, 2)}`).toEqual([]);
        }
      });
    });
  }
}
