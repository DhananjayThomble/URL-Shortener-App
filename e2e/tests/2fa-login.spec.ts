import { expect, test } from "@playwright/test";

/* E2E journey: 2FA login (issue #377). The login page now branches on the
   LoginResult union — a 2FA-enabled account gets a TOTP challenge step instead
   of an immediate session. In fixtures mode the account 2fa@snapurl.local
   returns a challenge, and code 123456 verifies. No session seed — this drives
   the real two-step form. */

test.describe("2FA login", () => {
  test("a 2FA account is challenged for a code, then reaches the dashboard", async ({ page }) => {
    await page.goto("/login");
    await page.getByPlaceholder("you@company.com").fill("2fa@snapurl.local");
    await page.getByPlaceholder("••••••••").fill("whatever-password");
    await page.getByRole("button", { name: "Sign in" }).click();

    // The password step is accepted but does NOT sign in — a TOTP challenge step
    // appears instead of navigating to the dashboard.
    const codeInput = page.getByRole("textbox", { name: "Authentication code" });
    await expect(codeInput).toBeVisible();
    await expect(page).toHaveURL(/\/login$/);

    // A wrong code is rejected and keeps us on the challenge step.
    await codeInput.fill("000000");
    await page.getByRole("button", { name: "Verify" }).click();
    await expect(codeInput).toBeVisible();
    await expect(page).toHaveURL(/\/login$/);

    // The correct fixture code completes the login and lands on the dashboard.
    await codeInput.fill("123456");
    await page.getByRole("button", { name: "Verify" }).click();
    await expect(page).toHaveURL(/\/links$/);
    await expect(page.getByRole("button", { name: /New link|Create a link/ }).first()).toBeVisible();
  });

  test("a non-2FA account still signs in directly (no challenge)", async ({ page }) => {
    await page.goto("/login");
    await page.getByPlaceholder("you@company.com").fill("demo@snapurl.local");
    await page.getByPlaceholder("••••••••").fill("demo-password-1234");
    await page.getByRole("button", { name: "Sign in" }).click();

    // No challenge step — straight to the dashboard.
    await expect(page).toHaveURL(/\/links$/);
    await expect(page.getByRole("textbox", { name: "Authentication code" })).toHaveCount(0);
  });
});
