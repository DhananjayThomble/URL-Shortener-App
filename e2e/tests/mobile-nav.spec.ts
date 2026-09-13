import { expect, test } from "@playwright/test";
import { seedSession } from "../support/session";

/* E2E journey: primary navigation on mobile viewports (audit finding DC1).
   The desktop sidebar (web/src/components/app-shell/index.tsx <aside hidden lg:flex>)
   is display:none below the Tailwind `lg` breakpoint (1024px). Before this fix a
   phone user who landed on /links could reach NO other section — the top bar had
   only +/search/avatar. The fix adds a `lg:hidden` hamburger that opens a drawer
   reusing the SAME NAV array as the sidebar, so the two can never drift.

   These are authenticated /(app) routes, so seedSession first. Selectors are
   accessible-name only (getByRole/getByLabel) per repo convention — the hamburger
   is aria-label "Open navigation menu", the drawer is role="dialog", and each
   destination is a role="link" scoped inside that dialog to avoid colliding with
   the (hidden) sidebar's identical links. Each nav link's accessible name is
   "<icon> <label> [<count>]" (e.g. "⛓ Links 7"), so link names are matched as a
   SUBSTRING on the label (no `exact`) — the label words are all unique. The
   default e2e project is Desktop Chrome, so the mobile describe sets a phone
   viewport via test.use(). */

const MOBILE = { viewport: { width: 390, height: 852 }, isMobile: true, hasTouch: true } as const;

// Every destination in the sidebar NAV array, in order. If a nav item is added
// to the app-shell NAV, add it here too — this list is the E2E's contract that
// the mobile drawer exposes the full navigation, not a subset.
const NAV_DESTINATIONS: { label: string; urlRe: RegExp }[] = [
  { label: "Links", urlRe: /\/links$/ },
  { label: "Analytics", urlRe: /\/analytics$/ },
  { label: "QR studio", urlRe: /\/qr$/ },
  { label: "Bio pages", urlRe: /\/bio$/ },
  { label: "Forms", urlRe: /\/forms$/ },
  { label: "Conversions", urlRe: /\/conversions$/ },
  { label: "Domains", urlRe: /\/domains$/ },
  { label: "Abuse reports", urlRe: /\/reports$/ },
  { label: "Developers", urlRe: /\/developers$/ },
  { label: "Team", urlRe: /\/team$/ },
  { label: "Settings", urlRe: /\/settings$/ },
];

test.describe("mobile navigation (below lg)", () => {
  test.use(MOBILE);

  test.beforeEach(async ({ page }) => {
    await seedSession(page);
  });

  test("the hamburger drawer exposes every navigation destination", async ({ page }) => {
    await page.goto("/links");

    // The desktop sidebar is hidden at this width; the mobile hamburger is the
    // only way to the rest of the app.
    const hamburger = page.getByRole("button", { name: "Open navigation menu" });
    await expect(hamburger).toBeVisible();

    // Open the drawer.
    await hamburger.click();
    const drawer = page.getByRole("dialog", { name: "Navigation" });
    await expect(drawer).toBeVisible();

    // The drawer must offer EVERY sidebar destination. Assert each one is present
    // and reachable as a link inside the drawer (scoped to avoid the hidden
    // sidebar's duplicate links tripping strict mode). Names are matched as a
    // substring because the accessible name carries the icon + count too.
    for (const dest of NAV_DESTINATIONS) {
      await expect(drawer.getByRole("link", { name: dest.label })).toBeVisible();
    }
  });

  test("tapping a destination navigates and closes the drawer", async ({ page }) => {
    await page.goto("/links");

    await page.getByRole("button", { name: "Open navigation menu" }).click();
    const drawer = page.getByRole("dialog", { name: "Navigation" });
    await expect(drawer).toBeVisible();

    // Navigate to a section that is NOT reachable from the top bar otherwise.
    await drawer.getByRole("link", { name: "Team" }).click();

    // The route changed and the drawer closed itself (route-change effect).
    await expect(page).toHaveURL(/\/team$/);
    await expect(page.getByRole("dialog", { name: "Navigation" })).toHaveCount(0);

    // Prove it is repeatable from the new page: open again, go somewhere else.
    await page.getByRole("button", { name: "Open navigation menu" }).click();
    const drawer2 = page.getByRole("dialog", { name: "Navigation" });
    await expect(drawer2).toBeVisible();
    await drawer2.getByRole("link", { name: "Analytics" }).click();
    await expect(page).toHaveURL(/\/analytics$/);
    await expect(page.getByRole("dialog", { name: "Navigation" })).toHaveCount(0);
  });

  test("the drawer can be dismissed without navigating (close button)", async ({ page }) => {
    await page.goto("/links");
    await page.getByRole("button", { name: "Open navigation menu" }).click();
    const drawer = page.getByRole("dialog", { name: "Navigation" });
    await expect(drawer).toBeVisible();

    // Closing must leave us where we were — the negative case that a stray tap
    // on the drawer chrome does not strand or navigate the user.
    await page.getByRole("button", { name: "Close navigation menu" }).click();
    await expect(page.getByRole("dialog", { name: "Navigation" })).toHaveCount(0);
    await expect(page).toHaveURL(/\/links$/);
  });
});

test.describe("desktop navigation (lg and up)", () => {
  test.use({ viewport: { width: 1280, height: 900 } });

  test.beforeEach(async ({ page }) => {
    await seedSession(page);
  });

  test("the sidebar shows and the mobile hamburger is hidden", async ({ page }) => {
    await page.goto("/links");

    // The mobile hamburger must NOT be shown at desktop width (lg:hidden). It may
    // exist in the DOM but must not be visible.
    await expect(page.getByRole("button", { name: "Open navigation menu" })).toBeHidden();

    // The desktop sidebar is present: its complementary landmark <aside> renders
    // the same nav links, visible at this width. Names carry the icon + count, so
    // match the label as a substring.
    const sidebar = page.getByRole("complementary");
    await expect(sidebar).toBeVisible();
    await expect(sidebar.getByRole("link", { name: "Team" })).toBeVisible();
    await expect(sidebar.getByRole("link", { name: "Analytics" })).toBeVisible();
  });
});
