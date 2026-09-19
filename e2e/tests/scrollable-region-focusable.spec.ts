import { expect, test } from "@playwright/test";
import { seedSession } from "../support/session";

/* Regression for #474: horizontally scrollable regions (code blocks, wide-table
   wrappers) must be keyboard-focusable, per axe-core's scrollable-region-focusable
   rule (WCAG 2.2 SC 2.1.1 Keyboard, impact=serious). The fix gives every such
   region an explicit tabIndex={0} plus role="region" and an accessible name:
     - TableWrap (web/src/components/ui/index.tsx) — the shared wide-table
       scroller used by bio, team, domains, reports, conversions, forms and
       developers.
     - the three standalone <pre> code blocks on /for-developers and
       /(app)/developers.

   Oracle: axe-core scrollable-region-focusable — a scrollable region must be
   reachable and operable by keyboard, i.e. it (or a focusable descendant) is
   present in the tab order. We assert on the ARIA contract the fix commits to
   (role="region" + accessible name + tabindex="0"/focusable) rather than
   reimplementing axe itself. Fixtures mode (no API/DB) for the authenticated
   routes; /for-developers is public marketing content and needs no session. */

async function expectFocusableRegion(region: ReturnType<import("@playwright/test").Page["getByRole"]>) {
  await expect(region).toBeVisible();
  await expect(region).toHaveAttribute("tabindex", "0");
  await region.focus();
  await expect(region).toBeFocused();
}

test.describe("scrollable regions are keyboard-focusable (scrollable-region-focusable)", () => {
  test("public /for-developers: both code-block regions are focusable and named", async ({ page }) => {
    await page.goto("/for-developers");
    await expectFocusableRegion(page.getByRole("region", { name: "POST /links example request" }));
    await expectFocusableRegion(page.getByRole("region", { name: "Webhook delivery example payload" }));
  });

  test("/(app)/developers: the language-tabbed snippet region is focusable and named", async ({ page }) => {
    await seedSession(page);
    await page.goto("/developers");
    await expectFocusableRegion(page.getByRole("region", { name: /Create a link example request/ }));
  });

  test("/(app)/developers: the API keys and Webhooks table wrappers are focusable and named", async ({ page }) => {
    await seedSession(page);
    await page.goto("/developers");
    await expectFocusableRegion(page.getByRole("region", { name: "API keys" }));
    await expectFocusableRegion(page.getByRole("region", { name: "Webhooks" }));
  });

  test("/team: the Members table and permission-matrix wrappers are focusable and named", async ({ page }) => {
    await seedSession(page);
    await page.goto("/team");
    await expect(page.getByRole("row", { name: /Arjun Kapoor/ })).toBeVisible();
    await expectFocusableRegion(page.getByRole("region", { name: "Members" }));
    await expectFocusableRegion(page.getByRole("region", { name: "What each role can do" }));
  });

  test("/bio: the pages table wrapper is focusable and named", async ({ page }) => {
    await seedSession(page);
    await page.goto("/bio");
    await expectFocusableRegion(page.getByRole("region", { name: "Your pages" }));
  });

  test("/conversions: the revenue-by-link table wrapper is focusable and named", async ({ page }) => {
    await seedSession(page);
    await page.goto("/conversions");
    await expectFocusableRegion(page.getByRole("region", { name: "Revenue by link" }));
  });
});
