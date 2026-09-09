import { expect, test } from "@playwright/test";
import { seedSession } from "../support/session";

/* E2E journey: the routing-rules editor inside the create-link drawer. Rules are
   the product's headline "route by anything" feature. Fixtures mode, accessible-
   name selectors (each control is labelled "Rule N <field>" from #352's work),
   no app changes. Assertions target the editor's own state (deterministic),
   which does not depend on fixture persistence. */

test.describe("routing rules editor", () => {
  test.beforeEach(async ({ page }) => {
    await seedSession(page);
  });

  test("add, configure, reorder and remove routing rules", async ({ page }) => {
    await page.goto("/links");
    await page.getByRole("button", { name: /New link|Create a link/ }).first().click();
    const drawer = page.getByRole("dialog", { name: "Create a link" });
    await expect(drawer).toBeVisible();

    // Switch to the Routing tab (a button with aria-selected, not a role=tab).
    await drawer.getByRole("button", { name: "Routing" }).click();

    // No rules yet — add the first, make it a country rule, give it a destination.
    await drawer.getByRole("button", { name: "＋ Add rule" }).click();
    const rule1Condition = drawer.getByRole("combobox", { name: "Rule 1 condition" });
    await expect(rule1Condition).toBeVisible();
    await rule1Condition.selectOption({ label: "Country is" });
    await drawer.getByRole("textbox", { name: "Rule 1 country" }).fill("IN");
    await drawer.getByRole("textbox", { name: "Rule 1 destination" }).fill("https://example.com/in");

    // Add a second rule — a device rule.
    await drawer.getByRole("button", { name: "＋ Add rule" }).click();
    const rule2Condition = drawer.getByRole("combobox", { name: "Rule 2 condition" });
    await expect(rule2Condition).toBeVisible();
    await rule2Condition.selectOption({ label: "Device is" });
    await expect(drawer.getByRole("combobox", { name: "Rule 2 device" })).toBeVisible();

    // Reorder: move rule 2 up. After the swap the (now) rule 1 is the device rule.
    await drawer.getByRole("button", { name: "Move rule 2 up" }).click();
    await expect(drawer.getByRole("combobox", { name: "Rule 1 device" })).toBeVisible();

    // Remove rule 2 (the country rule after the swap) — back to a single rule.
    await drawer.getByRole("button", { name: "Remove rule 2" }).click();
    await expect(drawer.getByRole("combobox", { name: "Rule 2 condition" })).toHaveCount(0);
    await expect(drawer.getByRole("combobox", { name: "Rule 1 condition" })).toBeVisible();
  });
});
