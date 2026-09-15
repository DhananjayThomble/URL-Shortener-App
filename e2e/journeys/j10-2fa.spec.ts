/**
 * Journey 10 — Settings / 2FA
 *
 * Enable 2FA via the API (the UI has the hooks but no settings page surface
 * for setup — confirmed by reading web/src/app/(app)/settings/page.tsx and
 * grep for useSetupTotp in *.tsx: zero results outside auth.ts hook definitions).
 *
 * Then sign out and sign back in through the TOTP challenge.
 *
 * Oracles:
 *   - packages/contract/src/auth.ts — TotpSetup, TotpRecoveryCodes,
 *     TotpChallenge, TotpVerifyInput, AuthSession
 *   - auth.controller.ts: POST /auth/2fa/setup → TotpSetup
 *   - auth.controller.ts: POST /auth/2fa/enable → TotpRecoveryCodes
 *   - auth.controller.ts: POST /auth/login → TotpChallenge (when 2FA enabled)
 *   - auth.controller.ts: POST /auth/2fa/verify → AuthSession
 *   - Invariant: a 2FA account's login returns a challenge, not a session.
 *   - Invariant: the correct TOTP code completes the login.
 *   - Finding (if any): whether the UI exposes a 2FA settings surface.
 */

import { expect, test } from "@playwright/test";
import {
  makeEmail,
  RUN_PASSWORD,
  registerUser,
  seedAccount,
  API_URL,
  totpCode,
} from "./helpers";

test.describe("Journey 10 — 2FA", () => {
  test("API: enable 2FA, sign in via TOTP challenge, sign back in correctly", async ({ page }) => {
    /* ---- Setup ---- */
    const email = makeEmail("j10-2fa");
    const session = await registerUser(email);

    /* ---- 1. Initiate TOTP setup ---- */
    const setupRes = await fetch(`${API_URL}/auth/2fa/setup`, {
      method: "POST",
      headers: { authorization: `Bearer ${session.accessToken}` },
    });
    expect(setupRes.ok, "POST /auth/2fa/setup should succeed").toBe(true);
    const setup = await setupRes.json() as { secret?: string; otpauthUri?: string };
    // Oracle: TotpSetup has otpauthUri and secret
    expect(typeof setup.secret, "2fa/setup should return a secret").toBe("string");
    expect(typeof setup.otpauthUri, "2fa/setup should return an otpauthUri").toBe("string");
    const secret = setup.secret!;

    /* ---- 2. Enable TOTP with a valid code ---- */
    const code1 = totpCode(secret);
    const enableRes = await fetch(`${API_URL}/auth/2fa/enable`, {
      method: "POST",
      headers: {
        authorization: `Bearer ${session.accessToken}`,
        "content-type": "application/json",
      },
      body: JSON.stringify({ code: code1 }),
    });
    expect(enableRes.ok, "POST /auth/2fa/enable should succeed").toBe(true);
    const enableBody = await enableRes.json() as { recoveryCodes?: string[] };
    // Oracle: TotpRecoveryCodes has recoveryCodes array (10 codes)
    expect(Array.isArray(enableBody.recoveryCodes), "enable should return recoveryCodes array").toBe(true);
    expect(enableBody.recoveryCodes?.length, "Should have 10 recovery codes").toBe(10);

    /* ---- 3. Sign in via the UI — should get a TOTP challenge ---- */
    await page.goto("/login");
    await page.getByPlaceholder(/you@company|email/i).fill(email);
    await page.getByPlaceholder(/password|••/i).first().fill(RUN_PASSWORD);
    await page.getByRole("button", { name: /sign in|log in/i }).click();

    // Oracle: login should NOT succeed immediately — a TOTP challenge step
    // (getByRole("textbox", { name: "Authentication code" })) must appear.
    const codeInput = page.getByRole("textbox", { name: /authentication code|code|totp/i });
    await expect(codeInput).toBeVisible({ timeout: 15_000 });
    // The page must still be on /login (no session yet)
    await expect(page).toHaveURL(/\/login/);

    /* ---- 4. A wrong code is rejected ---- */
    await codeInput.fill("000000");
    await page.getByRole("button", { name: /verify|submit|confirm/i }).click();
    // Must stay on the challenge step
    await expect(codeInput).toBeVisible({ timeout: 5_000 });

    /* ---- 5. The correct code lands on the dashboard ---- */
    // Wait up to 30 seconds for the time window to be safe
    const correctCode = totpCode(secret);
    await codeInput.clear();
    await codeInput.fill(correctCode);
    await page.getByRole("button", { name: /verify|submit|confirm/i }).click();
    await expect(page).toHaveURL(/\/links/, { timeout: 15_000 });

    /* ---- 6. Check: does the settings page have a 2FA management surface? ---- */
    await page.goto("/settings");
    await expect(page).toHaveURL(/\/settings/);
    await page.waitForLoadState("networkidle");

    const has2FASection = await page.getByText(/two.factor|2fa|authenticator/i).count() > 0;
    if (!has2FASection) {
      console.log(
        `[FINDING] J10: /settings page has no 2FA setup/management surface. ` +
        `useSetupTotp / useEnableTotp hooks exist in web/src/lib/api/hooks/auth.ts ` +
        `but are not wired to any settings UI component. ` +
        `Users can enable 2FA only via the API, not through the dashboard.`,
      );
    }
  });
});
