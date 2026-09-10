import { expect, test } from "@playwright/test";
import { seedSession } from "../support/session";

/* E2E journey: an authenticated user brings their own custom domain. They add a
   new domain, see it appear in the table as "Verifying DNS" with the DNS record
   the app asks them to create, then run the DNS check and watch it go "Live".
   A second case covers client-side validation rejecting a malformed domain.

   Builds on the #353 harness — fixtures mode (no API/DB), accessible-name
   selectors only (getByRole / getByPlaceholder — the Field label is not
   programmatically associated so getByLabel is avoided), seeded auth session,
   and a full-load fixture reset per test. Domains is an authenticated /(app)
   route, so seedSession runs before the first navigation. */

test.describe("custom domains", () => {
  test.beforeEach(async ({ page }) => {
    await seedSession(page);
  });

  test("an authenticated user can add a domain and verify it live", async ({ page }) => {
    // A unique domain per run so the assertions cannot match a seeded fixture
    // domain (snap.to / go.acme.com / acme.link).
    const domain = `e2e-${Date.now().toString(36)}.example.com`;

    // Full load (also the fixture reset) lands on the domains page.
    await page.goto("/domains");
    await expect(page).toHaveURL(/\/domains$/);

    // Open the add-domain form. The primary action toggles between "＋ Add
    // domain" and "Cancel"; match the add label specifically.
    await page.getByRole("button", { name: /Add domain/ }).click();

    // The domain input is addressed by its placeholder (the Field label is not
    // associated). Typing a valid name enables the "Add domain" submit button.
    await page.getByPlaceholder("go.example.com").fill(domain);
    await page.getByRole("button", { name: "Add domain" }).click();

    // The new domain appears in the status table. In fixtures a fresh domain
    // starts as status "verifying" -> the row shows a "Verifying DNS" chip.
    // The domain string also appears in the DNS setup card's record row (its
    // Name cell), so the status row is anchored by its "Verifying DNS" chip +
    // trailing "Check DNS" action to keep the locator unambiguous.
    const row = page.getByRole("row", { name: new RegExp(`${domain}.*Verifying DNS.*Check DNS`) });
    await expect(row).toBeVisible();

    // The "Finish setting up <domain>" DNS card renders with the CNAME record.
    await expect(page.getByText(`Finish setting up ${domain}`)).toBeVisible();
    await expect(page.getByRole("cell", { name: "edge.snapurl.in" })).toBeVisible();

    // Run the DNS check from the row. Fixtures flips the domain to live + SSL
    // active, so its status chip becomes "Live" and the setup card disappears.
    await row.getByRole("button", { name: "Check DNS" }).click();
    await expect(
      page.getByRole("row", { name: new RegExp(`${domain}.*Live`) }),
    ).toBeVisible();
    await expect(page.getByText(`Finish setting up ${domain}`)).toBeHidden();
  });

  test("a malformed domain is rejected client-side and not added", async ({ page }) => {
    await page.goto("/domains");
    await expect(page).toHaveURL(/\/domains$/);

    // Wait for the table to finish loading (a seeded domain is present) so the
    // "no new row" assertion is not racing the initial skeleton.
    await expect(page.getByRole("cell", { name: "snap.to" }).first()).toBeVisible();

    await page.getByRole("button", { name: /Add domain/ }).click();

    // A non-empty but malformed value: the submit button is only disabled while
    // the field is empty, so this string is submittable and must be rejected by
    // the client-side AddDomainInput schema (regex requires a real TLD).
    await page.getByPlaceholder("go.example.com").fill("notadomain");
    await page.getByRole("button", { name: "Add domain" }).click();

    // The validation message surfaces in the Field error and the form stays
    // open; no row for the rejected value is added to the table.
    await expect(page.getByText("That doesn't look like a domain name")).toBeVisible();
    await expect(page.getByPlaceholder("go.example.com")).toBeVisible();
    await expect(page.getByRole("cell", { name: "notadomain", exact: true })).toHaveCount(0);
  });
});
