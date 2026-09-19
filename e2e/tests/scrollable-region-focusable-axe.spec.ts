import AxeBuilder from "@axe-core/playwright";
import { expect, test } from "@playwright/test";
import { seedSession } from "../support/session";

/* Issue #463 — "Make scrollable data-table regions keyboard-reachable", split
   from #438 alongside #474. Same root cause and same fix as #474 (landed in
   #498): every wide table renders through the shared `TableWrap` scroll
   container in web/src/components/ui/index.tsx, which now sets
   tabIndex={0} + role="region" + an accessible name. #498's own regression
   spec (scrollable-region-focusable.spec.ts) covers /team, /bio,
   /conversions and the code-block pages via the ARIA contract directly; this
   spec instead runs the actual named oracle from #463 — axe-core's
   `scrollable-region-focusable` rule — across every remaining TableWrap
   route (/domains, /forms, /reports) plus the routes #498 already covers, to
   confirm 0 violations of that specific rule using axe itself rather than a
   hand-written assertion of the fix's own contract.

   Oracle: axe-core `scrollable-region-focusable` (WCAG 2.1 SC 2.1.1 Keyboard,
   impact=serious) — https://dequeuniversity.com/rules/axe/4.10/scrollable-region-focusable.
   Fixtures mode: a route's DOM structure for this check does not depend on
   whether data comes from the real API or the fixture backend. */

async function expectNoScrollableRegionViolations(page: import("@playwright/test").Page) {
  const results = await new AxeBuilder({ page }).withRules(["scrollable-region-focusable"]).analyze();
  expect(results.violations, JSON.stringify(results.violations, null, 2)).toEqual([]);
}

test.describe("scrollable-region-focusable — axe oracle (#463)", () => {
  test("public /for-developers", async ({ page }) => {
    await page.goto("/for-developers");
    await expectNoScrollableRegionViolations(page);
  });

  test("/(app)/developers", async ({ page }) => {
    await seedSession(page);
    await page.goto("/developers");
    await expectNoScrollableRegionViolations(page);
  });

  test("/team", async ({ page }) => {
    await seedSession(page);
    await page.goto("/team");
    await expectNoScrollableRegionViolations(page);
  });

  test("/bio", async ({ page }) => {
    await seedSession(page);
    await page.goto("/bio");
    await expectNoScrollableRegionViolations(page);
  });

  test("/conversions", async ({ page }) => {
    await seedSession(page);
    await page.goto("/conversions");
    await expectNoScrollableRegionViolations(page);
  });

  test("/domains", async ({ page }) => {
    await seedSession(page);
    await page.goto("/domains");
    await expectNoScrollableRegionViolations(page);
  });

  test("/forms", async ({ page }) => {
    await seedSession(page);
    await page.goto("/forms");
    await expectNoScrollableRegionViolations(page);
  });

  test("/reports", async ({ page }) => {
    await seedSession(page);
    await page.goto("/reports");
    await expectNoScrollableRegionViolations(page);
  });
});
