import { expect, test, type Locator } from "@playwright/test";
import { seedSession } from "../support/session";

/* Mobile touch-target sizing (audit findings DC2 MAJOR + DC4 minor).
   Below the lg breakpoint the primary interactive controls were far under the
   WCAG 2.5.8 (AA) 24px floor and the general 44px usability target: the mobile
   "＋ Create a link" button was ~13x20px, the account avatar ~29x29px, filter
   pills and segmented toggles ~28-31px tall, and the marketing hamburger 38x38px.
   The fix adds a shared `tap-target` utility (globals.css) that enforces a
   >=44px hit box on viewports below 1024px only, leaving desktop untouched.

   This spec renders each affected control at a mobile viewport and asserts its
   rendered box is at least 44px in the constrained dimension, then guards that
   the size bumps introduce no horizontal overflow. Fixtures mode; accessible-name
   selectors only. Desktop sizing is verified by the unchanged existing specs
   (the utility is inert at >=1024px). */

const MIN = 44;

async function box(locator: Locator) {
  await expect(locator).toBeVisible();
  const b = await locator.boundingBox();
  expect(b, "control has a rendered box").not.toBeNull();
  return b!;
}

test.describe("mobile touch targets (>=44px)", () => {
  test.use({ viewport: { width: 390, height: 852 }, isMobile: true, hasTouch: true });

  test.describe("authenticated app shell", () => {
    test.beforeEach(async ({ page }) => {
      await seedSession(page);
    });

    test("the topbar create button is at least 44x44px on mobile", async ({ page }) => {
      await page.goto("/links");
      await expect(page).toHaveURL(/\/links$/);
      // The mobile topbar trigger carries aria-label="Create a link" (the sidebar
      // "New link" variant is hidden below lg). Scope to it specifically.
      const create = page.getByRole("button", { name: "Create a link" });
      const b = await box(create);
      expect(b.height).toBeGreaterThanOrEqual(MIN);
      expect(b.width).toBeGreaterThanOrEqual(MIN);
    });

    test("the account menu avatar is at least 44x44px on mobile", async ({ page }) => {
      await page.goto("/links");
      const avatar = page.getByRole("button", { name: /Account menu/ });
      const b = await box(avatar);
      expect(b.height).toBeGreaterThanOrEqual(MIN);
      expect(b.width).toBeGreaterThanOrEqual(MIN);
    });

    test("a status filter pill is at least 44px tall on mobile", async ({ page }) => {
      await page.goto("/links");
      // Filter pills are aria-pressed toggle buttons; "All" is always present.
      const pill = page.getByRole("button", { name: "All", exact: true });
      const b = await box(pill);
      expect(b.height).toBeGreaterThanOrEqual(MIN);
    });

    test("a per-row action button is at least 44px tall on mobile", async ({ page }) => {
      await page.goto("/team");
      await expect(page).toHaveURL(/\/team$/);
      // Team rows expose size="sm" ghost/danger actions ("Change role" / "Remove")
      // for non-owner members. Take the first one that renders.
      const action = page.getByRole("button", { name: /Change role|Remove/ }).first();
      const b = await box(action);
      expect(b.height).toBeGreaterThanOrEqual(MIN);
    });

    test("a segmented toggle option is at least 44px tall on mobile", async ({ page }) => {
      await page.goto("/settings");
      await expect(page).toHaveURL(/\/settings$/);
      // The Appearance theme Segmented control renders option buttons with unique
      // labels; "Match system" is always present. (getByRole pressed:true can also
      // match the lighter Tabs variant, which is out of scope here.)
      const option = page.getByRole("button", { name: "Match system" });
      const b = await box(option);
      expect(b.height).toBeGreaterThanOrEqual(MIN);
    });
  });

  // Bumping every Button size="sm" and Segmented option to a >=44px box on mobile
  // must not push any page into horizontal overflow (the audit found none pre-fix;
  // this guards the regression). Checked at 360px, the smallest target Android
  // width, on pages that pack the most sm buttons / segmented rows.
  test.describe("no horizontal overflow after the size bumps", () => {
    test.use({ viewport: { width: 360, height: 800 }, isMobile: true, hasTouch: true });
    for (const path of ["/links", "/team", "/settings"]) {
      test(`${path} does not scroll horizontally on a 360px viewport`, async ({ page }) => {
        await seedSession(page);
        await page.goto(path);
        const { scrollW, clientW } = await page.evaluate(() => ({
          scrollW: document.documentElement.scrollWidth,
          clientW: document.documentElement.clientWidth,
        }));
        expect(
          scrollW,
          `${path} overflows: scrollWidth ${scrollW} > clientWidth ${clientW}`,
        ).toBeLessThanOrEqual(clientW + 1);
      });
    }
  });

  test.describe("marketing site header (DC4)", () => {
    test("the mobile hamburger toggle is at least 44x44px", async ({ page }) => {
      await page.goto("/pricing");
      const burger = page.getByRole("button", { name: /Open menu|Close menu/ });
      const b = await box(burger);
      expect(b.height).toBeGreaterThanOrEqual(MIN);
      expect(b.width).toBeGreaterThanOrEqual(MIN);
    });
  });
});
