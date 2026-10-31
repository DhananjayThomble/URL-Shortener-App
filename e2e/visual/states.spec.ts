import { expect, test } from "@playwright/test";
import { seedAppearance, seedSession, stabilise, VISUAL_EPOCH, visualSuite } from "./_helpers";

/* ============================================================================
   Interactive-state baselines — issue #870.

   The states a page-level shot misses, which is exactly where the known layout
   defects clustered. Each opens one piece of UI, then captures.

   No pointer hover (row actions are opacity-0 until group-hover,
   link-row.tsx:27): where a click is unavoidable we move the pointer to a
   documented inert coordinate (0,0, top-left gutter) BEFORE capture so a parked
   cursor never changes the frame.

   Each target is scoped to the viewport(s) where it is meaningful:
   - create-link drawer: a right-side sheet, captured on desktop (the Topbar
     "Create a link" control is present at every width, but one baseline is
     enough and desktop is the canonical layout).
   - mobile nav drawer: lg:hidden, so mobile only; it sets
     document.body.style.overflow="hidden", removing the scrollbar and reflowing
     width — the whole point of capturing it.
   ============================================================================ */

async function prepareApp(page: import("@playwright/test").Page, route = "/links"): Promise<void> {
  await seedAppearance(page);
  await page.clock.setFixedTime(VISUAL_EPOCH);
  await seedSession(page);
  await page.goto(route, { waitUntil: "domcontentloaded" });
  await page.waitForLoadState("networkidle");
  await page
    .getByText(/Checking your session…|Taking you to your dashboard…/)
    .waitFor({ state: "hidden", timeout: 5_000 })
    .catch(() => {});
  await stabilise(page);
}

/** Park the pointer in the inert top-left corner so no group-hover state shows. */
async function restPointer(page: import("@playwright/test").Page): Promise<void> {
  await page.mouse.move(0, 0);
}

visualSuite("visual · states", () => {
  test("create-link drawer (desktop)", async ({ page }, testInfo) => {
    test.skip(testInfo.project.name !== "desktop", "one drawer baseline, on the canonical desktop layout");
    await prepareApp(page, "/links");

    // Desktop create trigger is the Sidebar "＋ New link" button
    // (app-shell/index.tsx:235-236). The Topbar "Create a link" control is
    // lg:hidden, so it is absent at the desktop width.
    await page.getByRole("button", { name: /New link/ }).click();

    // The drawer traps focus and animates in; wait for the dialog, settle, rest
    // the pointer, then capture.
    const drawer = page.getByRole("dialog");
    await expect(drawer).toBeVisible();
    await stabilise(page);
    await restPointer(page);

    await expect(page).toHaveScreenshot("create-link-drawer.png", { fullPage: false });
  });

  test("mobile nav drawer (mobile)", async ({ page }, testInfo) => {
    test.skip(testInfo.project.name !== "mobile", "MobileNav is lg:hidden — mobile viewport only");
    await prepareApp(page, "/links");

    // app-shell/index.tsx:288 — the hamburger. Opening sets body overflow hidden,
    // removing the scrollbar and reflowing width.
    await page.getByRole("button", { name: "Open navigation menu" }).click();

    const nav = page.getByRole("dialog", { name: "Navigation" });
    await expect(nav).toBeVisible();
    await stabilise(page);
    await restPointer(page);

    await expect(page).toHaveScreenshot("mobile-nav-drawer.png", { fullPage: false });
  });
});
