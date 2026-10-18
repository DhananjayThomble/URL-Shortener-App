import { expect, test, type Page } from "@playwright/test";
import { fakeAccessToken, MOCK_USER, MOCK_WORKSPACE, mockApi, nestError, type MockReply } from "../support/mock-api";

/* #776 — the 2FA step of /login offers recovery codes, on a keyboard that can type them.

   It used to say only "Enter the 6-digit code from your authenticator app", with
   inputMode=numeric, so on a phone a user who had lost their authenticator saw a
   number pad and no way to enter a recovery code like "K7PQ2-XM9RD".

   Replies copy the API:
     apps/api/src/auth/auth.controller.ts  POST /auth/login       -> TotpChallenge for a 2FA account
     apps/api/src/auth/auth.service.ts     POST /auth/2fa/verify  -> AuthSession, or 401
       "That code isn't right. Try the next one from your app." (wrong TOTP AND wrong/used recovery code)
     apps/api/src/auth/token.service.ts    expired challenge      -> 401 "That sign-in attempt timed out. Start again."
     @Throttle 5/min on /auth/2fa/verify                          -> 429 "ThrottlerException: Too Many Requests"
   The mock's recovery code is single-use and matched exactly as the server
   stores it (uppercase, 5-5 with a dash), so a test only passes when the page
   sends that exact spelling. Runs on desktop Chrome and Pixel 7. */

const TOTP = "123456";
// Fake, mock-only value in the issued shape (TotpService.generateRecoveryCodes).
const RECOVERY = "K7PQ2-XM9RD";
const WRONG = "That code isn't right. Try the next one from your app.";
const TARGET = "/settings?section=security#two-factor";

type Opts = { throttle?: boolean; expired?: boolean };

async function mock2fa(page: Page, { throttle = false, expired = false }: Opts = {}) {
  let signedIn = false;
  let recoveryUsed = false;
  const session = (): MockReply => {
    signedIn = true;
    return { status: 200, body: { accessToken: fakeAccessToken(), refreshToken: "mock.refresh.token", user: MOCK_USER } };
  };
  const authed = (body: unknown) => (): MockReply => (signedIn ? { status: 200, body } : nestError(401, "Unauthorized"));
  return mockApi(page, {
    "GET /auth/me": authed(MOCK_USER),
    "POST /auth/login": { status: 200, body: { challenge: "totp", challengeToken: "mock.challenge" } },
    "POST /auth/2fa/verify": (req) => {
      if (throttle) return nestError(429, "ThrottlerException: Too Many Requests", "Too Many Requests");
      if (expired) return nestError(401, "That sign-in attempt timed out. Start again.");
      const code = (req.body as { code?: string })?.code;
      if (code === TOTP) return session();
      if (code === RECOVERY && !recoveryUsed) {
        recoveryUsed = true;
        return session();
      }
      return nestError(401, WRONG);
    },
    "GET /workspaces/current": authed(MOCK_WORKSPACE),
    "GET /auth/workspaces": authed([
      { id: MOCK_WORKSPACE.id, name: MOCK_WORKSPACE.name, initials: MOCK_WORKSPACE.initials, role: "owner", current: true },
    ]),
    "GET /links": authed({ items: [], total: 0, nextCursor: null }),
    "GET /bio-pages": authed([]),
    "GET /domains": authed([]),
    "GET /members": authed([]),
    "GET /api-keys": authed([]),
    "GET /webhooks": authed([]),
  });
}

async function toChallenge(page: Page, path = "/login") {
  await page.goto(path);
  await page.getByPlaceholder("you@company.com").fill(MOCK_USER.email);
  await page.getByPlaceholder("••••••••").fill("correct horse battery");
  await page.getByRole("button", { name: "Sign in" }).click();
  await expect(page.getByRole("textbox", { name: "Authentication code" })).toBeVisible();
}

const verifyCodes = (api: Awaited<ReturnType<typeof mock2fa>>) =>
  api.callsTo("POST", "/auth/2fa/verify").map((c) => (c.body as { code: string }).code);

test.describe("2FA step — recovery codes (#776)", () => {
  test("the TOTP step mentions recovery codes and keeps the numeric one-time-code field", async ({ page }) => {
    await mock2fa(page);
    await toChallenge(page);

    const code = page.getByRole("textbox", { name: "Authentication code" });
    await expect(code).toHaveAttribute("inputmode", "numeric");
    await expect(code).toHaveAttribute("autocomplete", "one-time-code");
    await expect(code).toBeFocused();
    await expect(page.getByText(/recovery code/i).first()).toBeVisible();
    await expect(page.getByRole("button", { name: "Use a recovery code" })).toBeVisible();

    // A pasted "123 456" (how authenticator apps display it) lands as six digits.
    await code.fill("123 456");
    await expect(code).toHaveValue("123456");
  });

  test("'Use a recovery code' switches to a text keyboard and signs in with the code as typed on a phone", async ({ page, baseURL }) => {
    const api = await mock2fa(page);
    await toChallenge(page, `/login?next=${encodeURIComponent(TARGET)}`);

    await page.getByRole("button", { name: "Use a recovery code" }).click();
    const code = page.getByRole("textbox", { name: "Recovery code" });
    await expect(code).toBeVisible();
    await expect(code).toBeFocused();
    await expect(code).toHaveAttribute("inputmode", "text");
    await expect(code).toHaveAttribute("autocomplete", "off");
    await expect(code).toHaveAttribute("autocapitalize", "characters");
    await expect(code).toHaveAttribute("placeholder", "XXXXX-XXXXX");
    await expect(page.getByRole("textbox", { name: "Authentication code" })).toHaveCount(0);
    await expect(page.getByRole("heading", { name: /recovery code/i })).toBeVisible();

    const verify = page.getByRole("button", { name: "Verify" });
    await expect(verify).toBeDisabled();
    // Lower case, a space for the dash — what a person types reading it off paper.
    await code.pressSequentially("k7pq2 xm9r");
    await expect(verify).toBeDisabled();
    await code.pressSequentially("d");
    await expect(verify).toBeEnabled();
    await verify.click();

    // #775's ?next= survives the 2FA step in recovery mode too.
    await expect(page).toHaveURL(`${baseURL}${TARGET}`);
    expect(verifyCodes(api)).toEqual([RECOVERY]);
  });

  test("a used recovery code is refused in recovery terms, and Enter submits", async ({ page, baseURL }) => {
    const api = await mock2fa(page);
    await toChallenge(page, `/login?next=${encodeURIComponent(TARGET)}`);
    await page.getByRole("button", { name: "Use a recovery code" }).click();
    const code = page.getByRole("textbox", { name: "Recovery code" });

    // Burn it once via the API mock (as a previous sign-in would have).
    await page.evaluate(async (c) => {
      await fetch("/api/v1/auth/2fa/verify", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ challengeToken: "mock.challenge", code: c }),
      });
    }, RECOVERY);

    await code.fill(RECOVERY);
    await code.press("Enter");
    const err = page.getByText(/already been used/i);
    await expect(err).toBeVisible();
    await expect(page.getByText(/from your app/i)).toHaveCount(0);
    await expect(code).toHaveAttribute("aria-invalid", "true");
    // The error is the field's description, so a screen reader announces it with the field.
    const describedBy = await code.getAttribute("aria-describedby");
    expect(describedBy).toBeTruthy();
    await expect(page.locator(`[id="${describedBy}"]`)).toHaveText(/already been used/i);
    await expect(page).toHaveURL(`${baseURL}/login?next=${encodeURIComponent(TARGET)}`);

    // Typing again clears the error.
    await code.fill("K7PQ2-XM9RE");
    await expect(err).toHaveCount(0);
    expect(verifyCodes(api)).toEqual([RECOVERY, RECOVERY]);
  });

  test("a throttled attempt says so", async ({ page }) => {
    await mock2fa(page, { throttle: true });
    await toChallenge(page);
    await page.getByRole("button", { name: "Use a recovery code" }).click();
    await page.getByRole("textbox", { name: "Recovery code" }).fill(RECOVERY);
    await page.getByRole("button", { name: "Verify" }).click();
    await expect(page.getByText(/too many/i)).toBeVisible();
    await expect(page.getByText(/already been used/i)).toHaveCount(0);
  });

  test("an expired challenge says start again, not 'wrong code'", async ({ page }) => {
    await mock2fa(page, { expired: true });
    await toChallenge(page);
    await page.getByRole("button", { name: "Use a recovery code" }).click();
    await page.getByRole("textbox", { name: "Recovery code" }).fill(RECOVERY);
    await page.getByRole("button", { name: "Verify" }).click();
    await expect(page.getByText("That sign-in attempt timed out. Start again.")).toBeVisible();
  });

  test("keyboard only: toggle there and back, the field is cleared and refocused each time", async ({ page }) => {
    const api = await mock2fa(page);
    await toChallenge(page);
    const totp = page.getByRole("textbox", { name: "Authentication code" });
    await totp.fill("12");

    const toRecovery = page.getByRole("button", { name: "Use a recovery code" });
    // Reachable by Tab from the field.
    for (let i = 0; i < 4 && !(await toRecovery.evaluate((el) => el === document.activeElement)); i++) {
      await page.keyboard.press("Tab");
    }
    await expect(toRecovery).toBeFocused();
    await page.keyboard.press("Enter");

    const recovery = page.getByRole("textbox", { name: "Recovery code" });
    await expect(recovery).toBeFocused();
    await expect(recovery).toHaveValue("");
    await page.keyboard.type("abc");
    await expect(recovery).toHaveValue("ABC");

    const back = page.getByRole("button", { name: "Use your authenticator app instead" });
    await back.focus();
    await page.keyboard.press("Space");
    await expect(totp).toBeFocused();
    await expect(totp).toHaveValue("");
    await expect(totp).toHaveAttribute("inputmode", "numeric");

    await page.keyboard.type(TOTP);
    await page.keyboard.press("Enter");
    await expect(page).toHaveURL(/\/links$/);
    expect(verifyCodes(api)).toEqual([TOTP]);
  });

  test("Back to sign in from recovery mode returns to the password step; a new challenge starts in TOTP mode", async ({ page }) => {
    await mock2fa(page);
    await toChallenge(page);
    await page.getByRole("button", { name: "Use a recovery code" }).click();
    await page.getByRole("button", { name: "Back to sign in" }).click();
    await expect(page.getByRole("heading", { name: "Welcome back" })).toBeVisible();
    await page.getByPlaceholder("you@company.com").fill(MOCK_USER.email);
    await page.getByPlaceholder("••••••••").fill("correct horse battery");
    await page.getByRole("button", { name: "Sign in" }).click();
    await expect(page.getByRole("textbox", { name: "Authentication code" })).toBeVisible();
    await expect(page.getByRole("textbox", { name: "Recovery code" })).toHaveCount(0);
  });
});
