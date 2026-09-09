import { expect, test } from "@playwright/test";
import { seedSession } from "../support/session";

/* E2E journey: edit a link's destination, then delete the link. Builds on the
   #353 harness — fixtures mode (no API/DB), accessible-name selectors only, and
   a seeded fixture link (spring-sale, id lnk_spring) as the subject. Fixture
   state resets on a full page load, so each test starts from a clean goto. */

test.describe("edit and delete a link", () => {
  test.beforeEach(async ({ page }) => {
    await seedSession(page);
  });

  test("an authenticated user can edit a link's destination", async ({ page }) => {
    await page.goto("/links");
    // Open the seeded link's detail page via its short-link in the row.
    await page.getByRole("link", { name: /spring-sale/ }).first().click();
    await expect(page).toHaveURL(/\/links\/lnk_spring$/);

    // Toggle the edit form open and change the destination.
    const newDestination = "https://example.com/e2e/edited-destination";
    await page.getByRole("button", { name: "Edit" }).click();
    const destination = page.getByPlaceholder("https://example.com/where-it-should-go");
    await expect(destination).toBeVisible();
    await destination.fill(newDestination);
    await page.getByRole("button", { name: "Save destination" }).click();

    // The edit card closes (Save gone) and the new destination is reflected in
    // the page sub-heading ("→ <destination> · created ...").
    await expect(page.getByRole("button", { name: "Save destination" })).toBeHidden();
    await expect(page.getByText(newDestination, { exact: false })).toBeVisible();
  });

  test("an authenticated user can delete a link and it leaves the list", async ({ page }) => {
    await page.goto("/links");
    // Confirm the target is present in the list first.
    await expect(page.getByRole("button", { name: /Copy short link .+\/spring-sale$/ })).toBeVisible();

    await page.getByRole("link", { name: /spring-sale/ }).first().click();
    await expect(page).toHaveURL(/\/links\/lnk_spring$/);

    // Delete is a two-step confirm: "Delete" -> "Delete for good".
    await page.getByRole("button", { name: "Delete this link" }).click();
    await page.getByRole("button", { name: "Delete for good" }).click();

    // The page navigates back to the list, and the deleted link is gone. (Fixture
    // state persists across this client-side nav — no full reload — so the delete
    // is visible in the list.)
    await expect(page).toHaveURL(/\/links$/);
    await expect(page.getByRole("button", { name: /Copy short link .+\/spring-sale$/ })).toHaveCount(0);
  });
});
