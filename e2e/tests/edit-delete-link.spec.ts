import { expect, test } from "@playwright/test";
import { seedSession } from "../support/session";

/* E2E journey: edit a link's destination, then delete the link. Builds on the
   #353 harness — fixtures mode (no API/DB), accessible-name selectors only, and
   a seeded fixture link (spring-sale) as the subject. Fixture state resets on a
   full page load, so each test starts from a clean goto.

   NOTE: We do NOT assert a fixture-specific id (e.g. lnk_spring) — the real API
   issues uuidv7 ids that differ from fixture short-ids. Instead we navigate to
   the link row, wait for the detail route (/links/<id>), capture the id the app
   actually produced from the URL, and assert the destination page shows the
   spring-sale slug — confirming it is the RIGHT link, without encoding the id
   format. (#445 fixture-fidelity fix) */

test.describe("edit and delete a link", () => {
  test.beforeEach(async ({ page }) => {
    await seedSession(page);
  });

  test("an authenticated user can edit a link's destination", async ({ page }) => {
    await page.goto("/links");
    // Open the seeded link's detail page via its short-link in the row.
    await page.getByRole("link", { name: /spring-sale/ }).first().click();

    // Wait for navigation to a link detail route (/links/<id>) without encoding
    // the id format — the real API issues uuidv7, the fixture uses short ids.
    await expect(page).toHaveURL(/\/links\/[^/]+$/);
    // Confirm we landed on the spring-sale link's page (slug visible in header/breadcrumb).
    await expect(page.getByText(/spring-sale/, { exact: false })).toBeVisible();

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

    // Wait for the link detail route without encoding the id format.
    await expect(page).toHaveURL(/\/links\/[^/]+$/);
    // Confirm it is the spring-sale link's detail page.
    await expect(page.getByText(/spring-sale/, { exact: false })).toBeVisible();

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
