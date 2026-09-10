import { expect, test } from "@playwright/test";
import { seedSession } from "../support/session";

/* E2E journey: the conversion-tracking dashboard (/(app)/conversions).

   Like analytics, this surface is READ-ONLY reporting: fixtures serve the same
   CONVERSIONS payload for every range (web/src/lib/api/fixtures.ts —
   GET /conversions ignores the range and returns CONVERSIONS), so this asserts
   render + interaction STABILITY (the funnel/tiles/tables/events render, the
   range Segmented control is live and mutually exclusive, and no error state
   appears) rather than range-specific numbers. The page's "Define an event",
   "Install tracking" and "＋ Add" buttons have no handlers, so we do not drive
   them — testing them would assert nothing.

   Accessible-name selectors only (getByRole / getByText); no CSS, no
   data-testid. Conversions is an authenticated /(app) route, so seedSession
   runs before the first navigation. */

test.describe("conversions dashboard", () => {
  test.beforeEach(async ({ page }) => {
    await seedSession(page);
  });

  test("renders the conversion report and the range switch keeps it stable", async ({ page }) => {
    // Full load (also the fixture reset) lands on the authenticated shell, not login.
    await page.goto("/conversions");
    await expect(page).toHaveURL(/\/conversions$/);

    // The page's own subtitle is unique on the page — a stable anchor that the
    // authenticated view (not a login redirect) actually rendered.
    await expect(
      page.getByText("Which links actually produced revenue — not which produced clicks."),
    ).toBeVisible();

    // The three report sections render (fixtures supply CONVERSIONS). These
    // headings are unique on the page, so no strict-mode collision with tiles.
    await expect(page.getByText("Funnel")).toBeVisible();
    await expect(page.getByText("Tracked events")).toBeVisible();
    await expect(page.getByText("Revenue by link")).toBeVisible();

    // Real conversion data is on the page: a seeded tracked-event name and a
    // seeded campaign in the revenue-by-link table.
    await expect(page.getByText("Subscription started")).toBeVisible();
    await expect(page.getByText("Spring 2026")).toBeVisible();

    // The server-side-attribution note (unique copy) confirms the events card body.
    await expect(page.getByText("Attribution is server-side.")).toBeVisible();

    // No error state on first load.
    await expect(page.getByText("That didn't load")).toHaveCount(0);

    // Switch the range (a Segmented of aria-pressed buttons: 24h/7d/30d/90d/12m).
    await page.getByRole("button", { name: "90d" }).click();
    await expect(page.getByRole("button", { name: "90d" })).toHaveAttribute("aria-pressed", "true");

    // The report remains rendered after the re-query; still no error state.
    await expect(page.getByText("Revenue by link")).toBeVisible();
    await expect(page.getByText("Spring 2026")).toBeVisible();
    await expect(page.getByText("That didn't load")).toHaveCount(0);

    // Switch again to confirm the control is live, not a one-shot.
    await page.getByRole("button", { name: "7d" }).click();
    await expect(page.getByRole("button", { name: "7d" })).toHaveAttribute("aria-pressed", "true");
    await expect(page.getByText("Funnel")).toBeVisible();
  });

  test("the range Segmented is mutually exclusive — selecting one clears the others", async ({ page }) => {
    // A validation-style invariant: the range control is a single-choice group,
    // so pressing 24h must leave 90d un-pressed. This guards against a regression
    // where the Segmented lets two ranges read as selected at once. The default
    // selection is 30d, so 24h starts un-pressed and 90d starts un-pressed.
    await page.goto("/conversions");
    await expect(page).toHaveURL(/\/conversions$/);

    const b24h = page.getByRole("button", { name: "24h" });
    const b90d = page.getByRole("button", { name: "90d" });

    // Default range is 30d, so neither 24h nor 90d is pressed initially.
    await expect(b24h).toHaveAttribute("aria-pressed", "false");
    await expect(b90d).toHaveAttribute("aria-pressed", "false");

    // Select 90d, then 24h. Only the most-recent choice may read as pressed.
    await b90d.click();
    await expect(b90d).toHaveAttribute("aria-pressed", "true");

    await b24h.click();
    await expect(b24h).toHaveAttribute("aria-pressed", "true");
    await expect(b90d).toHaveAttribute("aria-pressed", "false");

    // The report is still rendered (never fell into the error state) after the churn.
    await expect(page.getByText("That didn't load")).toHaveCount(0);
    await expect(page.getByText("Tracked events")).toBeVisible();
  });
});
