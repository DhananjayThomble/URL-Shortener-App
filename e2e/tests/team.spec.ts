import AxeBuilder from "@axe-core/playwright";
import { expect, test } from "@playwright/test";
import { seedSession } from "../support/session";

/* E2E journey: an authenticated user manages their workspace team on /team —
   they invite a new member (who appears in the Members table as a pending
   invite), then remove an existing member (who leaves the table). A negative
   case covers the invite form's client-side email validation. Builds on the
   #353 harness — fixtures mode (no API/DB), accessible-name selectors only.

   Fixture state (web/src/lib/api/fixtures.ts) resets on a full page load, so
   each test starts from a clean goto("/team"). Invited members get their name
   from the email localpart with [._-] collapsed to spaces, so the localpart is
   chosen free of those characters to keep the rendered name predictable.

   Note on selectors: Card is a plain <div> (no landmark role); the invite
   email input is addressed by its accessible label (Field associates its
   <label> with the real control — see #469), and actions by their button
   accessible names. */

test.describe("team invite and member management", () => {
  test.beforeEach(async ({ page }) => {
    await seedSession(page);
  });

  test("an authenticated user can invite a member and see them appear as pending", async ({ page }) => {
    // A unique localpart per run so the assertion cannot match a seeded fixture
    // member. No [._-] in the localpart: fixtures derive the display name from it
    // (collapsing those chars to spaces), and we assert on that exact name.
    const localpart = `e2eteammate${Date.now().toString(36)}`;
    const email = `${localpart}@example.com`;

    await page.goto("/team");
    await expect(page).toHaveURL(/\/team$/);

    // Open the invite form via the page-head toggle (labelled "＋ Invite").
    await page.getByRole("button", { name: /Invite/ }).click();
    const emailInput = page.getByLabel("Email");
    await expect(emailInput).toBeVisible();
    await emailInput.fill(email);
    await page.getByRole("button", { name: "Send invitation" }).click();

    // The form closes (its email input goes away) and the new member appears in
    // the Members table. The localpart is the invited member's display name;
    // "· pending" on the role chip is the invited-status marker.
    await expect(emailInput).toBeHidden();
    const invitedRow = page.getByRole("row", { name: new RegExp(localpart) });
    await expect(invitedRow).toBeVisible();
    await expect(invitedRow.getByText(/·\s*pending/)).toBeVisible();
  });

  test("an authenticated user can remove a member and it leaves the table", async ({ page }) => {
    await page.goto("/team");
    await expect(page).toHaveURL(/\/team$/);

    // Arjun Kapoor (u3, editor) is a seeded, non-owner active member — a safe
    // removal target. Confirm present first.
    const targetRow = page.getByRole("row", { name: /Arjun Kapoor/ });
    await expect(targetRow).toBeVisible();

    // Removal is a two-step confirm scoped to that member's row: the row's
    // "Remove" button swaps the actions to "Keep" / "Remove" (danger), so
    // clicking "Remove" a second time confirms.
    await targetRow.getByRole("button", { name: "Remove" }).click();
    await expect(targetRow.getByRole("button", { name: "Keep" })).toBeVisible();
    await targetRow.getByRole("button", { name: "Remove" }).click();

    // The row is gone from the table.
    await expect(page.getByRole("row", { name: /Arjun Kapoor/ })).toHaveCount(0);
  });

  test("inviting with a malformed email is rejected and adds no member", async ({ page }) => {
    await page.goto("/team");
    await expect(page).toHaveURL(/\/team$/);

    await page.getByRole("button", { name: /Invite/ }).click();
    const emailInput = page.getByLabel("Email");
    await expect(emailInput).toBeVisible();

    // A non-empty but malformed address: the Send button is enabled (only an
    // empty field disables it), so submit reaches the client-side zod guard.
    await emailInput.fill("not-an-email");
    await page.getByRole("button", { name: "Send invitation" }).click();

    // The contract's validation message surfaces on the Email field, the form
    // stays open (email input still visible), and no "not-an-email" row exists.
    await expect(page.getByText(/doesn't look like an email address/)).toBeVisible();
    await expect(emailInput).toBeVisible();
    await expect(page.getByRole("row", { name: /not-an-email/ })).toHaveCount(0);
  });

  /* Regression for #462, added per PR #515 review: the source-level and
     token-level checks in globals-contrast.test.ts cannot see a rendered
     page, and the original patch missed /team's member-avatar entirely (it
     only fixed app-shell's two badges) — axe-core measured five serious
     `color-contrast` nodes here in dark theme (member-avatar text-white on
     each of the five AVATAR_TONES backgrounds). This asserts on the actual
     rendered page under dark theme, the oracle the linked issue's acceptance
     criteria calls for.

     Dark is switched through Settings > Appearance, not by hand-setting the
     `data-theme` attribute: ThemeProvider also applies inline `--accent` /
     `--accent-ink` custom properties on mount (see settings.spec.ts), and
     skipping that step produces a false reading — a harness pitfall called
     out in PR #515's own description. */
  test("member-avatar has no color-contrast violation in dark theme", async ({ page }) => {
    await page.goto("/settings");
    await page.getByRole("button", { name: "Dark" }).click();
    await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");

    await page.goto("/team");
    await expect(page).toHaveURL(/\/team$/);
    // Wait for the Members table (not the loading skeleton) before scanning.
    await expect(page.getByRole("row", { name: /Arjun Kapoor/ })).toBeVisible();

    const results = await new AxeBuilder({ page }).withRules(["color-contrast"]).analyze();
    expect(results.violations, JSON.stringify(results.violations, null, 2)).toEqual([]);
  });
});
