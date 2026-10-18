/**
 * Journey 778 — Enter still submits /login after a failed attempt  @mobile
 *
 * QA (BUG-045, marked Unsure) saw: wrong password -> error -> fix the typo ->
 * Enter appeared to send no request, while clicking "Sign in" worked.
 *
 * This journey counts the REAL network requests the browser makes:
 *   password step: wrong password by click, wrong again by Enter in the
 *                  password field, then the right one by Enter in the EMAIL field;
 *   2FA step:      wrong code by click, wrong again by Enter, right one by Enter.
 * Every Enter must produce exactly one more request, and the right credentials
 * must sign in.
 *
 * Oracles:
 *   - POST /auth/login and POST /auth/2fa/verify seen by page.on("request")
 *     (the browser's own traffic) and their status codes from the real API;
 *   - the TOTP secret comes from POST /auth/2fa/setup on the real API, the
 *     correct code is derived from it (RFC 6238), never typed into this file;
 *   - the URL after the final Enter.
 *
 * Throttles (5/min per IP on /auth/login AND /auth/2fa/verify): each project does
 * 4 logins and 3 verifies; the mobile project starts after a pause so the two
 * never share a window. Requires the staging stack + web on :3000.
 */

import { expect, test, type Page, type Request } from "@playwright/test";
import { API_URL, RUN_PASSWORD, makeEmail, registerUser, totpCode } from "./helpers";

type Seen = { url: string; status: number | null };

/** Record every POST to `suffix` the page makes, and the status the API answered. */
function recordPosts(page: Page, suffix: string) {
  const seen: Seen[] = [];
  const byRequest = new Map<Request, Seen>();
  page.on("request", (r) => {
    if (r.method() !== "POST" || !r.url().endsWith(suffix)) return;
    const entry: Seen = { url: r.url(), status: null };
    byRequest.set(r, entry);
    seen.push(entry);
  });
  page.on("response", (res) => {
    const entry = byRequest.get(res.request());
    if (entry) entry.status = res.status();
  });
  return seen;
}

const statuses = (seen: Seen[]) => seen.map((s) => s.status);

async function enable2fa(accessToken: string): Promise<string> {
  const setup = (await (
    await fetch(`${API_URL}/auth/2fa/setup`, { method: "POST", headers: { authorization: `Bearer ${accessToken}` } })
  ).json()) as { secret: string };
  const res = await fetch(`${API_URL}/auth/2fa/enable`, {
    method: "POST",
    headers: { authorization: `Bearer ${accessToken}`, "content-type": "application/json" },
    body: JSON.stringify({ code: totpCode(setup.secret) }),
  });
  expect(res.ok, "POST /auth/2fa/enable").toBe(true);
  return setup.secret;
}

test.describe("Journey 778 — Enter after a failed login", () => {
  test("password step: Enter re-submits after a failed attempt, from the password and the email field @mobile", async ({ page, baseURL }, info) => {
    test.setTimeout(180_000);
    // Let the desktop project's logins age out of the 5/min throttle.
    if (info.project.name !== "desktop") await page.waitForTimeout(61_000);

    const email = makeEmail(`j778-pw-${info.project.name}`);
    await registerUser(email);
    const sent = recordPosts(page, "/auth/login");

    await page.goto("/login");
    const emailField = page.getByRole("textbox", { name: "Email" });
    const password = page.getByLabel("Password");
    const signIn = page.getByRole("button", { name: /sign in/i });
    await emailField.fill(email);
    await password.fill(`${RUN_PASSWORD}-typo`);

    /* ---- 1. Failed attempt, by click ---- */
    await signIn.click();
    await expect.poll(() => statuses(sent), { timeout: 15_000 }).toEqual([401]);
    const error = page.locator("form p.text-bad");
    await expect(error).toBeVisible();
    await expect(signIn).toBeEnabled();
    await page.screenshot({ path: info.outputPath(`after-failed-click-${info.project.name}.png`) });

    /* ---- 2. Edit the password, press Enter in the password field ---- */
    await password.fill(`${RUN_PASSWORD}-typo2`);
    await password.press("Enter");
    await expect.poll(() => statuses(sent), { timeout: 15_000 }).toEqual([401, 401]);
    await expect(error).toBeVisible();

    /* ---- 3. Fix it, press Enter in the EMAIL field (implicit submission from another field) ---- */
    await password.fill(RUN_PASSWORD);
    await emailField.focus();
    await page.keyboard.press("Enter");
    await expect.poll(() => statuses(sent), { timeout: 15_000 }).toEqual([401, 401, 200]);
    await expect(page).toHaveURL(`${baseURL}/links`, { timeout: 20_000 });
    // Exactly one request per Enter/click: nothing doubled, nothing swallowed.
    expect(sent).toHaveLength(3);
    await page.screenshot({ path: info.outputPath(`signed-in-${info.project.name}.png`) });
  });

  test("2FA step: Enter re-submits the code after a wrong one @mobile", async ({ page, baseURL }, info) => {
    test.setTimeout(180_000);
    const email = makeEmail(`j778-2fa-${info.project.name}`);
    const session = await registerUser(email);
    const secret = await enable2fa(session.accessToken);
    const logins = recordPosts(page, "/auth/login");
    const verifies = recordPosts(page, "/auth/2fa/verify");

    await page.goto("/login");
    await page.getByRole("textbox", { name: "Email" }).fill(email);
    await page.getByLabel("Password").fill(RUN_PASSWORD);
    await page.keyboard.press("Enter");
    const code = page.getByRole("textbox", { name: "Authentication code" });
    await expect(code).toBeVisible({ timeout: 15_000 });
    expect(statuses(logins)).toEqual([200]);

    // A code that is certainly wrong right now (and not the next step's either).
    const right = totpCode(secret);
    const wrong = right === "000000" ? "111111" : "000000";
    const wrong2 = right === "222222" ? "333333" : "222222";

    /* ---- 1. Wrong code, by click ---- */
    await code.fill(wrong);
    await page.getByRole("button", { name: "Verify" }).click();
    await expect.poll(() => statuses(verifies), { timeout: 15_000 }).toEqual([401]);
    await expect(page.getByText(/isn't right/i)).toBeVisible();
    await page.screenshot({ path: info.outputPath(`2fa-after-failed-click-${info.project.name}.png`) });

    /* ---- 2. Edit the code, Enter ---- */
    await code.fill(wrong2);
    await code.press("Enter");
    await expect.poll(() => statuses(verifies), { timeout: 15_000 }).toEqual([401, 401]);
    await expect(page.getByText(/isn't right/i)).toBeVisible();

    /* ---- 3. Right code, Enter ---- */
    await code.fill(totpCode(secret));
    await code.press("Enter");
    await expect.poll(() => statuses(verifies), { timeout: 15_000 }).toEqual([401, 401, 200]);
    await expect(page).toHaveURL(`${baseURL}/links`, { timeout: 20_000 });
    expect(verifies).toHaveLength(3);
    expect(logins).toHaveLength(1);
    await page.screenshot({ path: info.outputPath(`2fa-signed-in-${info.project.name}.png`) });
  });
});
