/**
 * Journey 776 — Sign in with a recovery code (2FA step)  @mobile
 *
 * A user with 2FA on who has lost their authenticator signs in with one of the
 * recovery codes they saved, typed the way a person reads it off paper on a
 * phone (lower case, a space instead of the dash). The same code is then
 * refused — recovery codes are single-use.
 *
 * Oracles:
 *   - the recovery codes come from POST /auth/2fa/enable on the real API
 *     (TotpRecoveryCodes) — never typed into this file;
 *   - packages/contract TotpVerifyInput ("a six-digit TOTP code, or one of the
 *     recovery codes"); TotpService: codes are single-use, compared upper-cased
 *     with whitespace stripped (the dash is part of the code);
 *   - the URL after each real click, and the request body the page sent.
 *
 * Throttles (5/min per IP on /auth/login AND /auth/2fa/verify): each project
 * does at most three logins and five verifies; the mobile project starts after
 * a pause so the two never share a window. Requires the staging stack + web :3000.
 */

import { expect, test, type Page } from "@playwright/test";
import { API_URL, RUN_PASSWORD, makeEmail, registerUser, totpCode } from "./helpers";

async function signIn(page: Page, email: string) {
  await page.getByPlaceholder(/you@company|email/i).fill(email);
  await page.getByPlaceholder(/password|••/i).first().fill(RUN_PASSWORD);
  await page.getByRole("button", { name: /sign in/i }).click();
}

/** What a person types reading "ABCDE-FGHJK" off paper on a phone. */
const asTypedOnPhone = (code: string) => code.toLowerCase().replace("-", " ");

async function enable2fa(accessToken: string): Promise<string[]> {
  const setup = (await (
    await fetch(`${API_URL}/auth/2fa/setup`, { method: "POST", headers: { authorization: `Bearer ${accessToken}` } })
  ).json()) as { secret: string };
  const res = await fetch(`${API_URL}/auth/2fa/enable`, {
    method: "POST",
    headers: { authorization: `Bearer ${accessToken}`, "content-type": "application/json" },
    body: JSON.stringify({ code: totpCode(setup.secret) }),
  });
  expect(res.ok, "POST /auth/2fa/enable").toBe(true);
  const { recoveryCodes } = (await res.json()) as { recoveryCodes: string[] };
  expect(recoveryCodes).toHaveLength(10);
  return recoveryCodes;
}

async function apiChallenge(email: string): Promise<string> {
  const res = await fetch(`${API_URL}/auth/login`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ email, password: RUN_PASSWORD }),
  });
  expect(res.ok, "POST /auth/login").toBe(true);
  const body = (await res.json()) as { challenge?: string; challengeToken?: string };
  expect(body.challenge).toBe("totp");
  return body.challengeToken!;
}

const apiVerify = (challengeToken: string, code: string) =>
  fetch(`${API_URL}/auth/2fa/verify`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ challengeToken, code }),
  });

test.describe("Journey 776 — recovery code at the 2FA step", () => {
  test("sign in with a recovery code typed on a phone keyboard; it cannot be used again @mobile", async ({ page, baseURL }, info) => {
    test.setTimeout(180_000);
    // Let the desktop project's logins/verifies age out of the 5/min throttles.
    if (info.project.name !== "desktop") await page.waitForTimeout(61_000);

    const email = makeEmail(`j776-${info.project.name}`);
    const session = await registerUser(email);
    const codes = await enable2fa(session.accessToken);
    const target = "/settings";

    const sent: string[] = [];
    page.on("request", (r) => {
      if (r.method() === "POST" && r.url().endsWith("/auth/2fa/verify")) sent.push((r.postDataJSON() as { code: string }).code);
    });

    /* ---- 1. Password, then the recovery-code option ---- */
    await page.goto(`/login?next=${encodeURIComponent(target)}`);
    await signIn(page, email);
    const totp = page.getByRole("textbox", { name: "Authentication code" });
    await expect(totp).toBeVisible({ timeout: 15_000 });
    await expect(totp).toHaveAttribute("inputmode", "numeric");
    await page.getByRole("button", { name: "Use a recovery code" }).click();

    const field = page.getByRole("textbox", { name: "Recovery code" });
    await expect(field).toBeFocused();
    await expect(field).toHaveAttribute("inputmode", "text");
    await field.pressSequentially(asTypedOnPhone(codes[0]!));
    await page.screenshot({ path: info.outputPath(`recovery-typed-${info.project.name}.png`) });
    await page.getByRole("button", { name: "Verify" }).click();

    /* ---- 2. Signed in, on the ?next= page ---- */
    await expect(page).toHaveURL(`${baseURL}${target}`, { timeout: 20_000 });
    await expect(page.getByRole("heading", { name: "Settings", exact: true })).toBeVisible({ timeout: 20_000 });
    // The page sent the issued spelling, not what was typed.
    expect(sent).toEqual([codes[0]]);

    /* ---- 3. The same code again is refused ---- */
    await page.evaluate(() => window.localStorage.clear());
    await page.goto("/login");
    await signIn(page, email);
    await expect(totp).toBeVisible({ timeout: 15_000 });
    await page.getByRole("button", { name: "Use a recovery code" }).click();
    await field.fill(codes[0]!);
    await page.getByRole("button", { name: "Verify" }).click();
    await expect(page.getByText(/already been used/i)).toBeVisible({ timeout: 15_000 });
    await expect(field).toHaveAttribute("aria-invalid", "true");
    await expect(page).toHaveURL(`${baseURL}/login`);
    await page.screenshot({ path: info.outputPath(`recovery-reused-${info.project.name}.png`) });

    if (info.project.name !== "desktop") return;

    /* ---- 4. Server-level facts (desktop only — the throttle budget) ---- */
    const challenge = await apiChallenge(email);
    // Single-use is enforced by the API, not just the page.
    expect((await apiVerify(challenge, codes[0]!)).status, "a used recovery code").toBe(401);
    // The API does not strip the dash: an unused code typed without it is refused…
    expect((await apiVerify(challenge, codes[1]!.replace("-", "").toLowerCase())).status, "dash-less code, raw").toBe(401);
    // …and accepted in the issued spelling — which is why the page normalises.
    expect((await apiVerify(challenge, codes[1]!)).status, "same code, issued spelling").toBe(200);
  });
});
