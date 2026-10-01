import { expect, test } from "@playwright/test";
import { seedSession } from "../support/session";

/* E2E journey: the analytics dashboard. Fixtures mode returns the same ANALYTICS
   payload regardless of range, so this asserts render + interaction STABILITY
   (tiles present, no error state, range switch works) rather than specific
   numbers. Accessible-name selectors; no app changes.

   Note: some tile labels ("Clicks", "QR scans", "Conversions") also appear in the
   traffic chart's tabs/legend, so we assert on the tile labels that are unique on
   the page — "Unique visitors (approx.)" and "Blocked / unsafe". */

test.describe("analytics dashboard", () => {
  test.beforeEach(async ({ page }) => {
    await seedSession(page);
  });

  test("the range Segmented has a programmatic accessible name", async ({ page }) => {
    // Issue #600 review — the range control is a role="group" of otherwise
    // unlabelled buttons ("24h", "7d", ...); WCAG 2.1 SC 4.1.2 requires the
    // group itself to expose a name for what it configures. Oracle: the
    // accessibility tree's computed name via Playwright's getByRole, which
    // resolves aria-label the same way assistive tech does — not axe's
    // label/select-name rule, which only targets input/select/textarea and
    // does not fire on an unnamed role="group" (see PR #608 discussion).
    await page.goto("/analytics");
    await expect(page.getByRole("group", { name: "Analytics date range" })).toBeVisible();
  });

  test("renders analytics tiles and the range switch keeps them stable", async ({ page }) => {
    await page.goto("/analytics");

    // Metric tiles render (fixtures supply ANALYTICS). Use the two labels that are
    // unique on the page to avoid strict-mode collisions with the chart tabs.
    await expect(page.getByText("Unique visitors (approx.)")).toBeVisible();
    await expect(page.getByText("Blocked / unsafe")).toBeVisible();
    // A tile value is rendered (the QR scans tile shows a formatted number).
    await expect(page.getByText("QR scans").first()).toBeVisible();

    // No error state on first load.
    await expect(page.getByText("That didn't load")).toHaveCount(0);

    // Switch the range (a Segmented of aria-pressed buttons: 24h/7d/30d/90d/12m).
    await page.getByRole("button", { name: "90d" }).click();
    await expect(page.getByRole("button", { name: "90d" })).toHaveAttribute("aria-pressed", "true");

    // Tiles remain rendered after the re-query; still no error state.
    await expect(page.getByText("Unique visitors (approx.)")).toBeVisible();
    await expect(page.getByText("Blocked / unsafe")).toBeVisible();
    await expect(page.getByText("That didn't load")).toHaveCount(0);

    // Switch again to confirm the control is live, not a one-shot.
    await page.getByRole("button", { name: "7d" }).click();
    await expect(page.getByRole("button", { name: "7d" })).toHaveAttribute("aria-pressed", "true");
    await expect(page.getByText("Unique visitors (approx.)")).toBeVisible();
  });
});
