import { expect, test, type Page } from "@playwright/test";
import { seedSession } from "../support/session";

/* Regression for #460: while the create-link drawer is open, Tab/Shift+Tab must
   cycle only through its own focusable elements (WCAG 2.1 SC 2.4.3 / APG "Dialog
   (Modal)"). Escape-to-close-and-return-focus-to-trigger is fixed by this same
   PR (#518): the issue body's claim that it was "already correct" was wrong —
   nothing previously captured or restored the pre-open activeElement, so this
   spec's second test is a real regression test, not a pre-existing guarantee.

   Oracle: the standard modal-dialog focus-trap pattern — tabbing past the last
   focusable element inside an open dialog must land back on the dialog's own
   *first* focusable element specifically (not merely "still somewhere in the
   dialog" — landing on the second element, for example, would silently skip
   the first and is just as much a trap failure), never on the sidebar, search
   or page content behind it; Shift+Tab from the first must land back on the
   *last*; and closing the dialog must return focus to whatever opened it. This
   is a keyboard/DOM-focus property, independent of any fixture data, so
   fixtures mode is the correct lane (same lane the original trap fix in PR
   #451 verified against).

   Runs at both desktop and mobile viewports: the trigger differs (sidebar's
   "New link" button vs. the topbar's icon-only "Create a link" button, hidden
   at `lg` and up), but the drawer and its focus-trap behaviour are identical at
   both sizes. */

const FOCUSABLE_SELECTOR =
  'a[href],button:not([disabled]),input:not([disabled]),select:not([disabled]),textarea:not([disabled]),[tabindex]:not([tabindex="-1"])';

/* Note on FOCUSABLE_SELECTOR (mirrors the drawer's own `queryFocusable` in
   create-link-drawer.tsx): the CSS selector alone is not sufficient, because
   `button:not([disabled])` matches a button given `tabIndex={-1}` as a prop
   (e.g. the inactive tabs in the roving-tabindex tablist) regardless of that
   tabIndex — only filtering on the live `.tabIndex` property afterward keeps
   the resulting list in sync with the real browser Tab order. Every helper
   below applies that extra `.tabIndex !== -1` filter alongside the selector. */

/** Index of the currently-focused element within the drawer's own focusable set,
 *  in DOM order, or -1 if focus is not on one of them (e.g. it escaped the trap). */
async function focusedIndexInDrawer(page: Page): Promise<number> {
  return page.evaluate((selector) => {
    const active = document.activeElement;
    const dialog = document.querySelector('[role="dialog"][aria-label="Create a link"]');
    if (!active || !dialog) return -1;
    const focusable = Array.from(dialog.querySelectorAll<HTMLElement>(selector)).filter(
      (node) => !node.closest('[aria-hidden="true"]') && node.tabIndex !== -1,
    );
    return focusable.indexOf(active as HTMLElement);
  }, FOCUSABLE_SELECTOR);
}

/** Count of the drawer's own real-tab-order focusable elements (see note above
 *  on why the raw CSS selector is not sufficient on its own). */
async function focusableCountInDrawer(drawer: import("@playwright/test").Locator): Promise<number> {
  return drawer.evaluate((el, selector) => {
    return Array.from(el.querySelectorAll<HTMLElement>(selector)).filter(
      (node) => !node.closest('[aria-hidden="true"]') && node.tabIndex !== -1,
    ).length;
  }, FOCUSABLE_SELECTOR);
}

/** Focuses the drawer's first real-tab-order focusable element directly (used
 *  to set up the Shift+Tab-from-first assertion without depending on how many
 *  real Tab presses it takes to get there). */
async function focusFirstInDrawer(drawer: import("@playwright/test").Locator): Promise<void> {
  await drawer.evaluate((el, selector) => {
    const nodes = Array.from(el.querySelectorAll<HTMLElement>(selector)).filter(
      (node) => !node.closest('[aria-hidden="true"]') && node.tabIndex !== -1,
    );
    nodes[0]?.focus();
  }, FOCUSABLE_SELECTOR);
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

    // Opening the drawer already moved focus to its first focusable element
    // (index 0); confirm that starting point precisely, since the Tab count
    // below is calculated relative to it.
    expect(await focusedIndexInDrawer(page)).toBe(0);

    // Collect the drawer's own real-tab-order focusable elements. Starting
    // from index 0, pressing Tab exactly `focusableCount` times must land back
    // on index 0 (asserted below) — anything else means either the trap
    // leaked to page content behind the drawer (index -1) or wrapped to the
    // wrong element (e.g. the second instead of the first, which would still
    // fail this exact-index check even though it "stayed inside the dialog").
    const focusableCount = await focusableCountInDrawer(drawer);
    expect(focusableCount).toBeGreaterThan(1);

    for (let i = 0; i < focusableCount; i++) {
      await page.keyboard.press("Tab");
    }
    expect(await focusedIndexInDrawer(page)).toBe(0);

    // Shift+Tab from the first focusable element must likewise wrap to the
    // *last* element exactly, never escape backwards out of the drawer and
    // never land on some other interior element.
    await focusFirstInDrawer(drawer);
    await page.keyboard.press("Shift+Tab");
    expect(await focusedIndexInDrawer(page)).toBe(focusableCount - 1);
  });

  test("Escape closes the drawer and returns focus to the trigger (fixed by #518, must not regress)", async ({ page }) => {
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
