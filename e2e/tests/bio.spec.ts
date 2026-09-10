import { expect, test } from "@playwright/test";
import { seedSession } from "../support/session";

/* E2E journey: the bio / link-in-bio page (/(app)/bio). An authenticated user
   creates a new bio page as a draft, sees it in their pages list, then publishes
   it and watches the status flip Draft -> Live. Bio pages are the product's
   "one link that holds all the others" feature; create + publish are the two
   real fixtures mutations (PUT /bio-pages keyed on domain+slug — a create and a
   status change are both an upsert), so the flow is deterministic against the
   in-memory fake.

   Fixtures mode (no API/DB). Accessible-name selectors only (getByRole /
   getByPlaceholder) — the Field/Input component does not associate its label, so
   inputs are addressed by placeholder. Semantic Table/Th/Td render a real table,
   so a page's row is located by its accessible name (concatenated cell text).
   One flow per file. */

test.describe("bio pages", () => {
  test.beforeEach(async ({ page }) => {
    await seedSession(page);
  });

  test("create a bio page as a draft, see it listed, then publish it", async ({ page }) => {
    // A unique back-half per run so the new row cannot collide with a seeded
    // fixture page (acme / priya / events / spring-hub).
    const slug = `e2e-bio-${Date.now().toString(36)}`;
    const name = "E2E Growth";

    // Full load (also the fixtures reset) lands on the bio page.
    await page.goto("/bio");
    await expect(page).toHaveURL(/\/bio$/);

    // Open the create form. The primary action toggles between "New page" and
    // "Cancel"; match the create label.
    await page.getByRole("button", { name: "＋ New page" }).click();

    // Fill the draft. Domain has a sensible default (first workspace domain), so
    // only the back-half and display name need values. Both are addressed by
    // placeholder because the Field label is not programmatically associated.
    await page.getByPlaceholder("yourname").fill(slug);
    await page.getByPlaceholder("Acme Growth").fill(name);

    // Create as a draft. Fixtures unshift the new page to the top of the store.
    await page.getByRole("button", { name: "Create as draft" }).click();

    // The new page shows in the "Your pages" table. Its row's accessible name
    // includes the mono "<domain>/<slug>" cell and its per-row action buttons.
    const newRow = page.getByRole("row", { name: new RegExp(`/${slug}\\b`) });
    await expect(newRow).toBeVisible();
    // It was created as a draft.
    await expect(newRow.getByText("Draft")).toBeVisible();

    // Because the create unshifts to index 0 and the editor renders pages[0],
    // the editor pane now targets the new page — its Publish button is present.
    // Publish it: the button reads "Publish" for a draft, "Unpublish" once live.
    const publish = page.getByRole("button", { name: "Publish" });
    await expect(publish).toBeVisible();
    await publish.click();

    // Fixtures upsert flips status to live; the row's chip and the editor button
    // both reflect it. Assert on the row (list is the source of truth) and that
    // the editor's toggle is now "Unpublish".
    await expect(newRow.getByText("Live")).toBeVisible();
    await expect(page.getByRole("button", { name: "Unpublish" })).toBeVisible();
  });

  test("cannot create a bio page without a back-half", async ({ page }) => {
    await page.goto("/bio");
    await expect(page).toHaveURL(/\/bio$/);

    // Wait for the pages table to finish loading (it renders a skeleton first),
    // then capture the row count so the "no page added" assertion is deterministic
    // rather than racing the initial fetch.
    const seededRow = page.getByRole("row", { name: /\/acme\b/ });
    await expect(seededRow).toBeVisible();
    const rowsBefore = await page.getByRole("row").count();

    await page.getByRole("button", { name: "＋ New page" }).click();

    // Fill only the display name, leaving the back-half empty. The page's own
    // guard rejects this client-side before any API call.
    await page.getByPlaceholder("Acme Growth").fill("No Slug");
    await page.getByRole("button", { name: "Create as draft" }).click();

    // The validation message is shown and no page was added.
    await expect(
      page.getByText("A page needs a domain, a back-half and a display name."),
    ).toBeVisible();
    expect(await page.getByRole("row").count()).toBe(rowsBefore);
  });
});
