/**
 * Journey 23 — a user sets, changes and clears a custom domain's root and 404
 * redirects from /domains (#648)
 *
 * Oracles (independent of the implementation):
 *   - Issue #648 acceptance criteria: a workspace can set a root redirect and a
 *     404 redirect on its own custom domain from the dashboard, the values
 *     persist, a blank field clears one, and the shared built-in domain cannot
 *     be edited by any tenant.
 *   - packages/contract `Domain`: rootRedirect / notFoundRedirect are
 *     string | null; `shared` marks the built-in domain.
 *   - Redirect service behaviour (README "custom domains"): a request for the
 *     domain root goes to rootRedirect, an unknown slug goes to
 *     notFoundRedirect, otherwise 404 with no Location.
 *
 * One password sign-in (login throttle is 5/min per IP). Requires the local
 * staging stack + web on :3000.
 */

import { expect, test, type APIRequestContext, type BrowserContext, type Page } from "@playwright/test";
import { API_URL, REDIRECT_URL, RUN_ID, RUN_PASSWORD, makeEmail, registerUser } from "./helpers";

const host = `j23-${RUN_ID}.example.com`;
const ROOT = `https://example.org/j23-root-${RUN_ID}`;
const NOT_FOUND = `https://example.org/j23-not-found-${RUN_ID}`;

async function redirectFor(request: APIRequestContext, path: string, forHost: string) {
  const res = await request.get(`${REDIRECT_URL}${path}`, {
    headers: { "X-Forwarded-Host": forHost },
    maxRedirects: 0,
  });
  return { status: res.status(), location: res.headers()["location"] ?? null };
}

test.describe("Journey 23 — domain root + 404 redirects (#648)", () => {
  // Each step builds on the previous one's saved state.
  test.describe.configure({ mode: "serial" });
  let context: BrowserContext;
  let page: Page;
  let token: string;
  let sharedHost: string;

  test.beforeAll(async ({ browser }, testInfo) => {
    const email = makeEmail("j23");
    const session = await registerUser(email);
    token = session.accessToken;

    const add = await fetch(`${API_URL}/domains`, {
      method: "POST",
      headers: { "content-type": "application/json", authorization: `Bearer ${token}` },
      body: JSON.stringify({ domain: host }),
    });
    expect(add.status, "POST /domains").toBe(201);

    const list = (await (await fetch(`${API_URL}/domains`, {
      headers: { authorization: `Bearer ${token}` },
    })).json()) as Array<{ domain: string; shared?: boolean }>;
    const shared = list.filter((d) => d.shared === true);
    expect(shared, "exactly one shared domain").toHaveLength(1);
    sharedHost = shared[0].domain;

    context = await browser.newContext({ baseURL: testInfo.project.use.baseURL, viewport: { width: 1280, height: 800 } });
    page = await context.newPage();
    await page.goto("/login");
    await page.getByPlaceholder("you@company.com").fill(email);
    await page.getByPlaceholder("••••••••").fill(RUN_PASSWORD);
    await page.getByRole("button", { name: "Sign in" }).click();
    await expect(page).toHaveURL(/\/links$/, { timeout: 20_000 });
  });

  test.afterAll(async () => {
    await context?.close();
  });

  /* The domain's own row: its first cell starts with the host name. (A pending
     domain also renders a DNS-instructions row that mentions the host.) */
  const escapeRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const row = (p: Page, h: string) =>
    p.locator("tbody tr").filter({ has: p.locator("td:first-child", { hasText: new RegExp(`^\\s*${escapeRe(h)}`) }) });

  test("shared domain has no edit control; custom domain does", async () => {
    await page.goto("/domains");
    await expect(row(page, host)).toBeVisible({ timeout: 15_000 });
    await expect(row(page, sharedHost)).toBeVisible();
    await expect(row(page, sharedHost).getByRole("button", { name: /Edit redirects/ })).toHaveCount(0);
    await expect(row(page, host).getByRole("button", { name: `Edit redirects for ${host}` })).toBeVisible();
  });

  test("set both redirects, reload, see them saved, and the redirect service follows them", async ({ request }) => {
    const before = await redirectFor(request, "/", host);
    expect(before).toEqual({ status: 404, location: null });

    await page.goto("/domains");
    await row(page, host).getByRole("button", { name: `Edit redirects for ${host}` }).click();
    const editor = page.getByRole("region", { name: `Redirects for ${host}` });
    await expect(editor).toBeVisible();

    const patch = page.waitForResponse((r) => r.request().method() === "PATCH" && r.url().includes("/domains/"));
    await editor.getByLabel("Root redirect").fill(ROOT);
    await editor.getByLabel("404 redirect").fill(NOT_FOUND);
    await editor.getByRole("button", { name: "Save redirects" }).click();
    expect((await patch).status()).toBe(200);
    await expect(editor).toHaveCount(0);

    await page.reload();
    await expect(row(page, host)).toContainText(ROOT, { timeout: 15_000 });
    await expect(row(page, host)).toContainText(NOT_FOUND);

    expect(await redirectFor(request, "/", host)).toEqual({ status: 302, location: ROOT });
    expect(await redirectFor(request, `/j23-missing-${RUN_ID}`, host)).toEqual({ status: 302, location: NOT_FOUND });
  });

  test("clear the root redirect; reload shows it cleared and root is 404 again, 404 redirect kept", async ({ request }) => {
    await page.goto("/domains");
    await row(page, host).getByRole("button", { name: `Edit redirects for ${host}` }).click();
    const editor = page.getByRole("region", { name: `Redirects for ${host}` });
    await expect(editor.getByLabel("Root redirect")).toHaveValue(ROOT);

    const patch = page.waitForResponse((r) => r.request().method() === "PATCH" && r.url().includes("/domains/"));
    await editor.getByLabel("Root redirect").fill("");
    await editor.getByRole("button", { name: "Save redirects" }).click();
    expect((await patch).status()).toBe(200);

    await page.reload();
    await expect(row(page, host)).toContainText(NOT_FOUND, { timeout: 15_000 });
    await expect(row(page, host)).not.toContainText(ROOT);
    await expect(row(page, host)).toContainText("not set");

    expect(await redirectFor(request, "/", host)).toEqual({ status: 404, location: null });
    expect(await redirectFor(request, `/j23-missing-${RUN_ID}`, host)).toEqual({ status: 302, location: NOT_FOUND });
  });

  test("an invalid URL is refused in the form and nothing is sent", async () => {
    await page.goto("/domains");
    await row(page, host).getByRole("button", { name: `Edit redirects for ${host}` }).click();
    const editor = page.getByRole("region", { name: `Redirects for ${host}` });
    let patched = false;
    page.on("request", (r) => { if (r.method() === "PATCH") patched = true; });
    await editor.getByLabel("Root redirect").fill("javascript:alert(1)");
    await editor.getByRole("button", { name: "Save redirects" }).click();
    await expect(editor).toBeVisible();
    await expect(editor.getByLabel("Root redirect")).toHaveAttribute("aria-invalid", "true");
    expect(patched).toBe(false);
    await editor.getByRole("button", { name: "Cancel" }).click();
    await expect(editor).toHaveCount(0);
  });
});
