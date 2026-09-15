import { expect, test } from "@playwright/test";
import { REAL_BACKEND } from "../support/real-session";
import {
  makeEmail,
  RUN_PASSWORD,
  registerAccount,
  registerWith2FA,
  totpCode,
} from "../support/unique-identity";

/* E2E journey: 2FA login (issue #377). The login page now branches on the
   LoginResult union — a 2FA-enabled account gets a TOTP challenge step instead
   of an immediate session. In fixtures mode the account 2fa@snapurl.local
   returns a challenge, and code 123456 verifies. No session seed — this drives
   the real two-step form.

   Idempotency (issue #440): in fixtures mode, fixed addresses (2fa@snapurl.local,
   demo@snapurl.local) are used because the fake is keyed on them. In real-stack
   mode, per-run unique accounts are registered in beforeAll — one with 2FA
   enabled (using the TOTP setup flow), one without. The correct TOTP code is
   generated from the secret returned by POST /auth/2fa/setup, using a pure
   Node.js RFC 6238 implementation in support/unique-identity.ts. */

/* Fixtures-mode sentinel addresses — kept for the fixtures lane, which the
   in-memory fake is keyed on. In real-stack mode these variables are replaced
   in beforeAll. */
let FA2_EMAIL = "2fa@snapurl.local";
let FA2_PASSWORD = "whatever-password";
let FA2_SECRET = ""; // only used on real backend
let PLAIN_EMAIL = "demo@snapurl.local";
let PLAIN_PASSWORD = "demo-password-1234";

test.describe("2FA login", () => {
  test.beforeAll(async () => {
    // Only run account creation when talking to the real backend.
    // In fixtures mode the variables above keep their hard-coded values and
    // the fake handles the rest (challenge + code 123456).
    if (!REAL_BACKEND) return;

    // Create a 2FA-enabled account for the first test.
    const twoFa = await registerWith2FA(makeEmail("2fa"), RUN_PASSWORD);
    FA2_EMAIL = twoFa.email;
    FA2_PASSWORD = twoFa.password;
    FA2_SECRET = twoFa.secret;

    // Create a plain (no-2FA) account for the second test.
    const plain = await registerAccount(makeEmail("plain"), RUN_PASSWORD);
    PLAIN_EMAIL = plain.email;
    PLAIN_PASSWORD = plain.password;
  });

  test("a 2FA account is challenged for a code, then reaches the dashboard", async ({ page }) => {
    await page.goto("/login");
    await page.getByPlaceholder("you@company.com").fill(FA2_EMAIL);
    await page.getByPlaceholder("••••••••").fill(FA2_PASSWORD);
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

    // The correct code completes the login and lands on the dashboard.
    // In fixtures mode: code 123456 (hard-coded in the fake).
    // In real-stack mode: a live TOTP code generated from the secret.
    const correctCode = REAL_BACKEND ? totpCode(FA2_SECRET) : "123456";
    await codeInput.fill(correctCode);
    await page.getByRole("button", { name: "Verify" }).click();
    await expect(page).toHaveURL(/\/links$/);
    await expect(page.getByRole("button", { name: /New link|Create a link/ }).first()).toBeVisible();
  });

  test("a non-2FA account still signs in directly (no challenge)", async ({ page }) => {
    await page.goto("/login");
    await page.getByPlaceholder("you@company.com").fill(PLAIN_EMAIL);
    await page.getByPlaceholder("••••••••").fill(PLAIN_PASSWORD);
    await page.getByRole("button", { name: "Sign in" }).click();

    // No challenge step — straight to the dashboard.
    await expect(page).toHaveURL(/\/links$/);
    await expect(page.getByRole("textbox", { name: "Authentication code" })).toHaveCount(0);
  });
});
