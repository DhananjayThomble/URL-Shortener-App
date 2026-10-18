/**
 * Journey 777 — Signed-in visitors on marketing pages and on /login, /register (#777)  @mobile
 *
 *   signed in:  marketing header shows "Go to dashboard", not Sign in / Start free
 *               (no flash; no API request to find out), and it opens /links
 *               /login and /register go straight to the dashboard (or a safe ?next=)
 *   signed out: Sign in / Start free; the login form is shown
 *   sign out:   the header flips back on the next client-side navigation to "/"
 *   dead session (refresh token revoked by a real POST /auth/logout):
 *               the stored tokens look present, so "Go to dashboard" shows, but
 *               /login shows the form (it verified with GET /auth/me), clears the
 *               tokens, and does not loop
 *
 * Oracles: the account is created through the real API (POST /auth/register); the
 * revoked session through the real POST /auth/logout (steering: refresh tokens are
 * revoked server-side); the URL after each real click; the real GET /auth/me status.
 *
 * Throttles: register is 5/min and login 5/min per IP, so each project registers
 * two accounts and signs in through the UI once. Requires the local staging stack
 * plus web on :3000 (playwright.journeys.config.ts).
 */

import { expect, test, type Page } from "@playwright/test";
import { API_URL, REFRESH_KEY, RUN_PASSWORD, TOKEN_KEY, makeEmail, registerUser, seedAccount, type Session } from "./helpers";

const header = (page: Page) => page.locator("header").first();

/** On a phone the header controls live in the hamburger menu (server-rendered button: retry until hydrated). */
async function openMenuIfMobile(page: Page) {
  const burger = page.getByRole("button", { name: "Open menu" });
  if (!(await burger.isVisible())) return;
  const menu = page.locator("#mobile-menu");
  await expect(async () => {
    if (!(await menu.isVisible())) await burger.click();
    await expect(menu).toBeVisible({ timeout: 1_000 });
  }).toPass();
}

/** Remembers whether `header .<cls>` was painted in ANY frame (so a flash cannot hide behind a final-state check). */
async function watchPainted(page: Page, cls: "auth-out" | "auth-in") {
  await page.addInitScript((c) => {
    const w = window as unknown as { __painted: boolean };
    w.__painted = false;
    const tick = () => {
      document.querySelectorAll(`header .${c}`).forEach((el) => {
        if (getComputedStyle(el).display !== "none") w.__painted = true;
      });
      requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
  }, cls);
}
const painted = (page: Page) => page.evaluate(() => (window as unknown as { __painted: boolean }).__painted);

const storedTokens = (page: Page) =>
  page.evaluate(([a, r]) => [localStorage.getItem(a!), localStorage.getItem(r!)], [TOKEN_KEY, REFRESH_KEY]);

test.describe("Journey 777 — signed-in marketing header + auth-page redirect", () => {
  let live: Session;
  let dead: Session;

  test.beforeAll(async ({}, info) => {
    live = await registerUser(makeEmail(`j777-live-${info.project.name}`));
    dead = await registerUser(makeEmail(`j777-dead-${info.project.name}`));
    // Revoke the second account's refresh-token family on the real API, as a sign-out elsewhere would.
    const out = await fetch(`${API_URL}/auth/logout`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ refreshToken: dead.refreshToken, allDevices: true }),
    });
    expect(out.status, "POST /auth/logout").toBeLessThan(300);
  });

  test("signed out: Sign in / Start free, and the login form", async ({ page }) => {
    await watchPainted(page, "auth-in");
    await page.goto("/");
    await openMenuIfMobile(page);
    await expect(header(page).getByRole("link", { name: "Sign in" })).toBeVisible();
    await expect(header(page).getByRole("link", { name: "Start free" })).toBeVisible();
    await expect(header(page).getByRole("link", { name: "Go to dashboard" })).toHaveCount(0);
    expect(await painted(page)).toBe(false);
    await page.goto("/login");
    await expect(page.getByRole("button", { name: "Sign in" })).toBeVisible();
  });

  test("signed in: Go to dashboard on the marketing pages, no flash, and it opens the dashboard @mobile", async ({ page, baseURL }, info) => {
    await seedAccount(page, live);
    await watchPainted(page, "auth-out");
    const apiCalls: string[] = [];
    page.on("request", (r) => {
      if (r.url().startsWith(API_URL)) apiCalls.push(r.url());
    });

    for (const path of ["/", "/pricing", "/product"]) {
      await page.goto(path);
      await openMenuIfMobile(page);
      await expect(header(page).getByRole("link", { name: "Go to dashboard" })).toBeVisible();
      await expect(header(page).getByRole("link", { name: "Sign in" })).toHaveCount(0);
      await expect(header(page).getByRole("link", { name: "Start free" })).toHaveCount(0);
      expect(await painted(page), `${path}: Sign in / Start free painted`).toBe(false);
      if (path === "/") await page.screenshot({ path: info.outputPath(`header-signed-in-${info.project.name}.png`) });
    }
    // Finding out cost nothing: the static marketing pages made no API request.
    expect(apiCalls).toEqual([]);

    await page.goto("/");
    await openMenuIfMobile(page);
    await header(page).getByRole("link", { name: "Go to dashboard" }).click();
    await expect(page).toHaveURL(`${baseURL}/links`, { timeout: 20_000 });
    await expect(page.getByRole("button", { name: /New link|Create a link/i }).first()).toBeVisible({ timeout: 20_000 });
    await page.screenshot({ path: info.outputPath(`dashboard-after-header-${info.project.name}.png`) });
  });

  test("signed in: /login and /register go to the dashboard, or a safe ?next= @mobile", async ({ page, baseURL }) => {
    await seedAccount(page, live);
    for (const route of ["/login", "/register"]) {
      await page.goto(route);
      await expect(page, route).toHaveURL(`${baseURL}/links`, { timeout: 20_000 });
    }
    await page.goto(`/login?next=${encodeURIComponent("/analytics?range=7d")}`);
    await expect(page).toHaveURL(`${baseURL}/analytics?range=7d`, { timeout: 20_000 });
    await page.goto(`/register?next=${encodeURIComponent("/settings")}`);
    await expect(page).toHaveURL(`${baseURL}/settings`, { timeout: 20_000 });
    // A crafted link must stay on this origin and never loop through an auth page.
    for (const next of ["//evil.example", "https://evil.example/x", "/login"]) {
      await page.goto(`/login?next=${encodeURIComponent(next)}`);
      await expect(page, `next=${next}`).toHaveURL(`${baseURL}/links`, { timeout: 20_000 });
    }
  });

  test("sign in through the form, sign out, and the header follows without a reload @mobile", async ({ page, baseURL }) => {
    const email = makeEmail(`j777-ui-${test.info().project.name}`);
    await registerUser(email);
    await page.goto(`/login?next=${encodeURIComponent("/pricing")}`);
    await page.getByPlaceholder(/you@company|email/i).fill(email);
    await page.getByPlaceholder(/password|••/i).first().fill(RUN_PASSWORD);
    await page.getByRole("button", { name: /sign in/i }).click();
    // router.push to a marketing page: the pre-paint script never saw these tokens.
    await expect(page).toHaveURL(`${baseURL}/pricing`, { timeout: 20_000 });
    await openMenuIfMobile(page);
    await expect(header(page).getByRole("link", { name: "Go to dashboard" })).toBeVisible();

    await header(page).getByRole("link", { name: "Go to dashboard" }).click();
    await expect(page).toHaveURL(`${baseURL}/links`, { timeout: 20_000 });
    await page.getByRole("button", { name: /Account menu/i }).click();
    await page.getByRole("menu").getByText("Sign out").click();
    await expect(page).toHaveURL(`${baseURL}/login`, { timeout: 15_000 });
    expect(await storedTokens(page)).toEqual([null, null]);

    // Client-side navigation back to the marketing site.
    await page.getByRole("link", { name: "SnapURL" }).click();
    await expect(page).toHaveURL(`${baseURL}/`);
    await openMenuIfMobile(page);
    await expect(header(page).getByRole("link", { name: "Sign in" })).toBeVisible();
    await expect(header(page).getByRole("link", { name: "Go to dashboard" })).toHaveCount(0);
  });

  test("dead session (refresh token revoked on the server): form shown, tokens cleared, no loop @mobile", async ({ page, baseURL }, info) => {
    // The access JWT outlives a server-side logout until its own 15-minute expiry, so a truly dead
    // session is a revoked refresh token PLUS an access token the API no longer accepts.
    await seedAccount(page, { ...dead, accessToken: "expired.access.token" });
    const visits: string[] = [];
    page.on("framenavigated", (f) => {
      if (f === page.mainFrame() && visits[visits.length - 1] !== f.url()) visits.push(f.url());
    });

    // The marketing page cannot know (no request is made), so it still offers "Go to dashboard".
    await page.goto("/");
    await openMenuIfMobile(page);
    await expect(header(page).getByRole("link", { name: "Go to dashboard" })).toBeVisible();

    // /login DOES verify against the real API: GET /auth/me 401, POST /auth/refresh 401.
    await page.goto("/login");
    await expect(page.getByPlaceholder(/you@company|email/i)).toBeVisible({ timeout: 20_000 });
    expect(await storedTokens(page)).toEqual([null, null]);
    await page.screenshot({ path: info.outputPath(`dead-session-login-${info.project.name}.png`) });
    const settled = visits.length;
    await page.waitForTimeout(2_000);
    expect(visits.length, `navigations after settling: ${visits.slice(settled).join(", ")}`).toBe(settled);
    await expect(page).toHaveURL(`${baseURL}/login`);
    expect(visits.filter((u) => u.endsWith("/links"))).toEqual([]);

    // And the marketing header is signed-out again now the tokens are gone. Navigate client-side:
    // seedAccount's init script would re-plant the dead tokens on a full page load.
    await page.getByRole("link", { name: "SnapURL" }).click();
    await expect(page).toHaveURL(`${baseURL}/`);
    await openMenuIfMobile(page);
    await expect(header(page).getByRole("link", { name: "Sign in" })).toBeVisible();
    await expect(header(page).getByRole("link", { name: "Go to dashboard" })).toHaveCount(0);
  });
});
