import { expect, test, type Page } from "@playwright/test";
import { seedSession } from "../support/session";

/* Regression for #460: while the create-link drawer is open, Tab/Shift+Tab must
   cycle only through its own focusable elements (WCAG 2.1 SC 2.4.3 / APG "Dialog
   (Modal)"). Escape-to-close and return-focus-to-trigger are already correct
   per the issue body and must not regress.

   Oracle: the standard modal-dialog focus-trap pattern — tabbing past the last
   focusable element inside an open dialog must land back on the dialog's own
   first focusable element, never on the sidebar, search or page content behind
   it; and closing the dialog must return focus to whatever opened it. This is a
   keyboard/DOM-focus property, independent of any fixture data, so fixtures
   mode is the correct lane (same lane the original trap fix in PR #451 verified
   against).

   Runs at both desktop and mobile viewports: the trigger differs (sidebar's
   "New link" button vs. the topbar's icon-only "Create a link" button, hidden
   at `lg` and up), but the drawer and its focus-trap behaviour are identical at
   both sizes. */

async function isFocusInsideDrawer(page: Page): Promise<boolean> {
  return page.evaluate(() => {
    const active = document.activeElement;
    const dialog = document.querySelector('[role="dialog"][aria-label="Create a link"]');
    return !!active && !!dialog && dialog.contains(active);
  });
}

function runFocusTrapChecks() {
  test.beforeEach(async ({ page }) => {
    await seedSession(page);
  });

  test("Tab past the last focusable element cycles back to the drawer's first element", async ({ page }) => {
    await page.goto("/links");
    const trigger = page.getByRole("button", { name: /New link|Create a link/ }).first();
    await trigger.click();

    const drawer = page.getByRole("dialog", { name: "Create a link" });
    await expect(drawer).toBeVisible();

    // Opening the drawer must move focus inside it, not leave it on the trigger
    // or anywhere in the page behind it.
    expect(await isFocusInsideDrawer(page)).toBe(true);

    // Collect the drawer's own focusable elements in DOM order, then Tab that
    // many times. If the trap holds, the (n+1)th Tab wraps to the first element
    // instead of escaping to page content behind the drawer.
    const focusableCount = await drawer.evaluate((el) => {
      const FOCUSABLE =
        'a[href],button:not([disabled]),input:not([disabled]),select:not([disabled]),textarea:not([disabled]),[tabindex]:not([tabindex="-1"])';
      return Array.from(el.querySelectorAll<HTMLElement>(FOCUSABLE)).filter(
        (node) => !node.closest('[aria-hidden="true"]'),
      ).length;
    });
    expect(focusableCount).toBeGreaterThan(1);

    for (let i = 0; i < focusableCount; i++) {
      await page.keyboard.press("Tab");
    }

    // One more Tab than there are focusable elements: a leaking trap would move
    // focus to the sidebar/search/page chrome behind the drawer.
    await page.keyboard.press("Tab");
    expect(await isFocusInsideDrawer(page)).toBe(true);

    // Shift+Tab from the first focusable element must likewise wrap to the last,
    // never escape backwards out of the drawer.
    await drawer.evaluate((el) => {
      const FOCUSABLE =
        'a[href],button:not([disabled]),input:not([disabled]),select:not([disabled]),textarea:not([disabled]),[tabindex]:not([tabindex="-1"])';
      const nodes = Array.from(el.querySelectorAll<HTMLElement>(FOCUSABLE)).filter(
        (node) => !node.closest('[aria-hidden="true"]'),
      );
      nodes[0]?.focus();
    });

    await page.keyboard.press("Shift+Tab");
    expect(await isFocusInsideDrawer(page)).toBe(true);
  });

  test("Escape closes the drawer and returns focus to the trigger (must not regress)", async ({ page }) => {
    await page.goto("/links");
    const trigger = page.getByRole("button", { name: /New link|Create a link/ }).first();
    await trigger.click();

    const drawer = page.getByRole("dialog", { name: "Create a link" });
    await expect(drawer).toBeVisible();

    await page.keyboard.press("Escape");
    await expect(drawer).toBeHidden();
    await expect(trigger).toBeFocused();
  });
}

test.describe("create-link drawer traps keyboard focus — desktop", () => {
  runFocusTrapChecks();
});

test.describe("create-link drawer traps keyboard focus — mobile", () => {
  test.use({ viewport: { width: 390, height: 852 }, isMobile: true, hasTouch: true });
  runFocusTrapChecks();
});
