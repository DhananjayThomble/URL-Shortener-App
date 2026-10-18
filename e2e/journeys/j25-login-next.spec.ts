/**
 * Journey 25 — Protected deep link -> sign in -> back on that page (#775)  @mobile
 *
 * Before #775 the (app) layout guard sent a signed-out visitor to a bare
 * /login, so after signing in they always landed on /links instead of the page
 * they opened (a link's detail page from an email, /analytics, …).
 *
 *   signed out: open /links/<real id>?tab=… -> /login?next=<that page>
 *   sign in (password, and password + TOTP)   -> back on that exact page
 *   a hostile ?next= (//host, /\host, https://host, javascript:) -> /links here
 *
 * Oracles:
 *   - the link id and slug come from POST /links on the real API (never typed);
 *   - the URL after each real click, and the link detail page showing the
 *     slug the API returned;
 *   - TOTP via POST /auth/2fa/setup + /enable on the real API (j10 pattern).
 *
 * Sign-ins: the API's login throttle is 5/min per IP (see j14/j15), so each
 * project does at most two UI sign-ins and the hostile sweep (one sign-in per
 * vector) runs on desktop only, after a pause. Requires the local staging
 * stack + web on :3000.
 */

import { expect, test, type Page } from "@playwright/test";
import { API_URL, RUN_PASSWORD, createLink, makeEmail, registerUser, totpCode } from "./helpers";

async function signIn(page: Page, email: string) {
  await page.getByPlaceholder(/you@company|email/i).fill(email);
  await page.getByPlaceholder(/password|••/i).first().fill(RUN_PASSWORD);
  await page.getByRole("button", { name: /sign in/i }).click();
}

test.describe("Journey 25 — login ?next= (#775)", () => {
  test("deep link to a link's detail page survives sign-in @mobile", async ({ page, baseURL }, info) => {
    const email = makeEmail(`j25-deep-${info.project.name}`);
    const session = await registerUser(email);
    const link = await createLink(session.accessToken, { destination: "https://example.com/j25-deep" });
    const target = `/links/${link.id}?tab=analytics`;

    // A fresh, signed-out browser opens the deep link (e.g. from an email).
    await page.goto(target);
    await expect(page).toHaveURL(`${baseURL}/login?next=${encodeURIComponent(target)}`, { timeout: 20_000 });

    await signIn(page, email);
    await expect(page).toHaveURL(`${baseURL}${target}`, { timeout: 20_000 });
    // The page is really that link's detail page, not just the URL.
    await expect(page.getByText(link.slug, { exact: true }).first()).toBeVisible({ timeout: 20_000 });
    await page.screenshot({ path: info.outputPath(`deep-link-landed-${info.project.name}.png`), fullPage: false });
  });

  test("the 2FA step preserves next @mobile", async ({ page, baseURL }, info) => {
    const email = makeEmail(`j25-2fa-${info.project.name}`);
    const session = await registerUser(email);
    const setup = (await (
      await fetch(`${API_URL}/auth/2fa/setup`, { method: "POST", headers: { authorization: `Bearer ${session.accessToken}` } })
    ).json()) as { secret: string };
    const enable = await fetch(`${API_URL}/auth/2fa/enable`, {
      method: "POST",
      headers: { authorization: `Bearer ${session.accessToken}`, "content-type": "application/json" },
      body: JSON.stringify({ code: totpCode(setup.secret) }),
    });
    expect(enable.ok, "POST /auth/2fa/enable").toBe(true);

    const target = "/analytics?range=7d";
    await page.goto(target);
    await expect(page).toHaveURL(`${baseURL}/login?next=${encodeURIComponent(target)}`, { timeout: 20_000 });
    await signIn(page, email);

    const code = page.getByRole("textbox", { name: /authentication code/i });
    await expect(code).toBeVisible({ timeout: 15_000 });
    await expect(page).toHaveURL(`${baseURL}/login?next=${encodeURIComponent(target)}`);
    await code.fill(totpCode(setup.secret));
    await page.getByRole("button", { name: /verify/i }).click();

    await expect(page).toHaveURL(`${baseURL}${target}`, { timeout: 20_000 });
    await expect(page.getByRole("heading", { name: "Analytics", exact: true })).toBeVisible({ timeout: 20_000 });
    await page.screenshot({ path: info.outputPath(`2fa-landed-${info.project.name}.png`), fullPage: false });
  });

  test("a hostile next lands on /links on this origin", async ({ page, baseURL }, info) => {
    test.setTimeout(210_000);
    const email = makeEmail("j25-hostile");
    await registerUser(email);
    const origin = new URL(baseURL!).origin;
    const offSite: string[] = [];
    page.on("request", (r) => {
      if (r.isNavigationRequest() && new URL(r.url()).origin !== origin) offSite.push(r.url());
    });
    page.on("dialog", (d) => {
      offSite.push(`dialog:${d.message()}`);
      void d.dismiss();
    });

    // Let the two sign-ins above age out of the 5/min login throttle.
    await page.waitForTimeout(61_000);
    for (const next of ["//evil.example", "/\\evil.example", "https://evil.example/links", "javascript:alert(document.domain)"]) {
      await page.goto(`/login?next=${encodeURIComponent(next)}`);
      await signIn(page, email);
      await expect(page, `next=${JSON.stringify(next)}`).toHaveURL(`${baseURL}/links`, { timeout: 20_000 });
      await page.evaluate(() => window.localStorage.clear());
    }
    expect(offSite).toEqual([]);
    await page.screenshot({ path: info.outputPath("hostile-landed.png"), fullPage: false });
    // …and leave the throttle window clean for whatever runs next.
    await page.waitForTimeout(61_000);
  });
});
