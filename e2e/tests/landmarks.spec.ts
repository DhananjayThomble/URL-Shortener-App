import AxeBuilder from "@axe-core/playwright";
import { expect, test } from "@playwright/test";
import { seedSession } from "../support/session";

/* ============================================================
   Issue #499 — page content must live inside a landmark, and every route must
   expose exactly one <main>.

   Oracle: axe-core's own landmark-family rules — `region` plus every rule whose id
   starts with `landmark` (`landmark-one-main`, `landmark-no-duplicate-banner`,
   `landmark-unique`, `landmark-banner-is-top-level`, `landmark-main-is-top-level`,
   `landmark-complementary-is-top-level`, `landmark-no-duplicate-contentinfo`,
   `landmark-no-duplicate-main`, `landmark-contentinfo-is-top-level`, etc.) — WCAG
   2.1's "Info and Relationships" / landmark navigation guidance these rules encode.
   Run with the full default ruleset (no withRules filter) AND asserted against the
   whole landmark family (not a fixed subset), so a regression in any landmark rule
   is caught. `bypass` (skip-link/heading coverage) is deliberately excluded — it is
   not a landmark-structure rule.

   This is pure client-side markup — a route's DOM structure is identical whether
   the data behind it comes from fixtures or the real API — so, per qa-oracles.md
   §5 and the acceptance criteria on #499, this lives in e2e/tests/ (the fixtures
   suite CI actually runs), not the manual real-stack a11y lab in e2e/a11y/.

   --- Marketing routes ---
   Every marketing page (/, /product, /for-developers, /pricing, /self-host) shares
   the same shell: SiteHeader (the page's one <header>, outside any landmark, hence
   the document's sole `banner`) + page content + SiteFooter (`contentinfo`). Before
   the fix, the content was siblings of SiteHeader with no landmark of its own, and
   each page additionally rendered a second hero <header> — which, not being nested
   in `main`/`article`/`aside`/`nav`/`section`, was ALSO an implicit `banner`,
   tripping `landmark-no-duplicate-banner` / `landmark-unique`. Wrapping the content
   in <main> gives it a landmark AND demotes the hero <header> (now a descendant of
   <main>) out of the banner role per the HTML AAM mapping.

   --- (app) routes ---
   The (app) layout already had a <main>, but the Topbar's own controls (mobile nav
   trigger, create button, search, account menu) rendered in a plain <div> sibling
   of <main> — content outside any landmark. Topbar is now a <header> (safe: no
   (app) route renders SiteHeader, so there is still exactly one banner per page).

   --- Coverage note ---
   Only routes reachable without driving a real backend are covered here. Auth
   routes (/login, /register) and dynamic routes (/links/[id], /b/[slug], /p/[slug],
   /f/[slug]) are not scanned by this spec — they are unaffected by this fix (verified
   by reading their source: f/[slug] and p/[slug] already render their own <main>,
   and (auth) pages were not touched) but are not asserted here.
   ============================================================ */

function runAxe(page: import("@playwright/test").Page) {
  // No withRules: the full default ruleset, per the issue's explicit ask that a
  // landmark regression anywhere is caught, not only in a fixed subset of rules.
  return new AxeBuilder({ page }).analyze();
}

// The whole landmark-family rule set, not a fixed list of ids: any axe rule id
// that starts with "landmark" (landmark-one-main, landmark-no-duplicate-banner,
// landmark-unique, landmark-banner-is-top-level, landmark-main-is-top-level,
// landmark-complementary-is-top-level, landmark-no-duplicate-contentinfo,
// landmark-no-duplicate-main, landmark-contentinfo-is-top-level, and any future
// landmark-* rule axe adds) plus "region". `bypass` is deliberately excluded —
// it is skip-link/heading coverage, not landmark structure.
const isLandmarkRule = (id: string) => id.startsWith("landmark") || id === "region";

function landmarkViolations(violations: Awaited<ReturnType<typeof runAxe>>["violations"]) {
  return violations
    .filter((v) => isLandmarkRule(v.id))
    .flatMap((v) => v.nodes.map((n) => ({ rule: v.id, target: n.target.join(" "), html: n.html.slice(0, 200) })));
}

const MARKETING_ROUTES = ["/", "/product", "/for-developers", "/pricing", "/self-host"];

const APP_ROUTES = ["/developers", "/team", "/bio", "/conversions"];

const VIEWPORTS = [
  { name: "desktop", width: 1280, height: 900 },
  { name: "mobile", width: 390, height: 844 },
] as const;

for (const vp of VIEWPORTS) {
  test.describe(`landmarks — ${vp.name}`, () => {
    test.use({ viewport: { width: vp.width, height: vp.height } });

    test.describe("marketing routes (public, no auth)", () => {
      for (const route of MARKETING_ROUTES) {
        test(`${route} has exactly one <main> and no landmark violations`, async ({ page }) => {
          await page.goto(route);
          await page.waitForLoadState("networkidle").catch(() => {});

          const mainCount = await page.locator("main, [role=main]").count();
          expect(mainCount, `expected exactly one <main> on ${route}`).toBe(1);

          const { violations } = await runAxe(page);
          const found = landmarkViolations(violations);
          expect(found, JSON.stringify(found, null, 2)).toEqual([]);
        });
      }
    });

    test.describe("(app) routes (authenticated)", () => {
      test.beforeEach(async ({ page }) => {
        await seedSession(page);
      });

      for (const route of APP_ROUTES) {
        test(`${route} has exactly one <main> and no landmark violations`, async ({ page }) => {
          await page.goto(route);
          await page.waitForLoadState("networkidle").catch(() => {});

          const mainCount = await page.locator("main, [role=main]").count();
          expect(mainCount, `expected exactly one <main> on ${route}`).toBe(1);

          const { violations } = await runAxe(page);
          const found = landmarkViolations(violations);
          expect(found, JSON.stringify(found, null, 2)).toEqual([]);
        });
      }
    });
  });
}
