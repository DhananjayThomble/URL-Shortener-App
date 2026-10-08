import { expect, test, type Locator, type Page } from "@playwright/test";
import { seedSession } from "../support/session";

/* Issue #657 — the sidebar drew a clicks quota meter ("412.9K / 1.0M", a filling
   bar, "One quota, clicks only.") for a cap that does not exist.

   Oracles (none of them is the component under test):
   - docs/DECISIONS.md, Billing: `clicksIncluded` is a column nothing enforces;
     the bar "drew a cap that does not exist … Now a plain count."
   - /pricing: "Clicks · counted, never capped".
   - Settings → Usage, which already renders the bare monthly count. The sidebar
     and the drawer must agree with it exactly, so the expected number is read
     off that page rather than hard-coded — the check holds against the
     fixtures fake and the real stack alike. */

async function usageCount(page: Page): Promise<string> {
  await page.goto("/settings");
  // Scoped to <main>: the sidebar renders its own "Clicks this month" too.
  const row = page.getByRole("main").getByText("Clicks this month", { exact: true }).locator("xpath=..");
  const value = row.locator("b");
  await expect(value).toHaveText(/^\d[\d,]*$/);
  return (await value.textContent())!.trim();
}

/** The sidebar/drawer widget: the element two levels above its "Clicks this
 *  month" label (label → row → widget), located by visible text rather than a
 *  test id so the check reads the same DOM before and after the fix. */
const clicksWidget = (scope: Locator) =>
  scope.getByText("Clicks this month", { exact: true }).locator("xpath=../..");

async function expectPlainCount(widget: Locator, expected: string) {
  await expect(widget).toBeVisible();
  await expect(widget.locator("b")).toHaveText(expected);
  // No denominator, no meter, no capped-quota wording.
  await expect(widget).not.toContainText("/");
  await expect(widget).not.toContainText(/one quota/i);
  await expect(widget).toContainText(/never capped/i);
  await expect(widget.locator("i, [role=progressbar], meter, progress")).toHaveCount(0);
}

test.describe("Clicks this month is a plain count, not a quota meter (#657)", () => {
  test.beforeEach(async ({ page }) => {
    await seedSession(page);
  });

  test("desktop sidebar shows the same plain count as Settings → Usage", async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 800 });
    const expected = await usageCount(page);
    await page.goto("/links");
    await expectPlainCount(clicksWidget(page.locator("aside")), expected);
  });

  test("mobile drawer shows the same plain count as Settings → Usage", async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    const expected = await usageCount(page);
    await page.goto("/links");
    await page.getByRole("button", { name: "Open navigation menu" }).click();
    const drawer = page.getByRole("dialog", { name: "Navigation" });
    await expectPlainCount(clicksWidget(drawer), expected);
  });
});

test("homepage does not describe clicks as a quota (#657)", async ({ page }) => {
  await page.goto("/");
  await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
  await expect(page.locator("body")).not.toContainText(/one quota/i);
});
