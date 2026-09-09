import { expect, test } from "@playwright/test";
import { seedSession } from "../support/session";

/* Issue #353 — the first end-to-end journey: an authenticated user opens the
   create-link drawer, fills a destination and back-half, submits, and sees the
   new short link in their list. Runs against fixtures mode (no API/DB).

   Selectors use accessible names only (getByRole / getByLabel) — issue #352 gave
   every ambiguous control a unique accessible name for exactly this. No CSS, no
   data-testid. */

test.describe("create a link", () => {
  test.beforeEach(async ({ page }) => {
    await seedSession(page);
  });

  test("an authenticated user can shorten a URL and see it in their list", async ({ page }) => {
    // A unique back-half per run so the assertion cannot match a seeded fixture link.
    const slug = `e2e-${Date.now().toString(36)}`;
    const destination = "https://example.com/e2e/landing";

    // Full load (also the fixture reset) lands on the links page, not the login route.
    await page.goto("/links");
    await expect(page).toHaveURL(/\/links$/);

    // Open the create-link drawer. The sidebar's trigger is labelled "New link";
    // the topbar's icon variant carries aria-label="Create a link" but is hidden
    // at desktop width. Match either so the test is width-robust.
    await page
      .getByRole("button", { name: /New link|Create a link/ })
      .first()
      .click();
    const drawer = page.getByRole("dialog", { name: "Create a link" });
    await expect(drawer).toBeVisible();

    // The destination and slug inputs are addressed by their placeholders
    // (the drawer's Field labels are not programmatically associated).
    await drawer.getByPlaceholder("https://acme.com/collections/spring-2026").fill(destination);
    await drawer.getByPlaceholder("spring-sale").fill(slug);

    // Submit.
    await drawer.getByRole("button", { name: "Create link" }).click();

    // The drawer closes and the new link appears at the top of the list. Its copy
    // button's accessible name embeds the short link (issue #352:
    // "Copy short link <domain>/<slug>"), which is the stable, unique locator.
    await expect(drawer).toBeHidden();
    await expect(
      page.getByRole("button", { name: new RegExp(`Copy short link .+/${slug}$`) }),
    ).toBeVisible();
  });
});
