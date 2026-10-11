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

import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { expect, test, type APIRequestContext, type BrowserContext, type Page } from "@playwright/test";
import { API_URL, REDIRECT_URL, RUN_ID, RUN_PASSWORD, makeEmail, registerUser } from "./helpers";

const run = promisify(execFile);
const API_CONTAINER = process.env.QA_API_CONTAINER ?? "snapurl-staging-api-1";
const DB_CONTAINER = process.env.DB_CONTAINER ?? "snapurl-staging-postgres";

const host = `j23-${RUN_ID}.example.com`;
const ROOT = `https://example.org/j23-root-${RUN_ID}`;
const NOT_FOUND = `https://example.org/j23-not-found-${RUN_ID}`;
/* The built-in short domain, from the stack's own configuration (DEFAULT_DOMAIN
   is the redirect origin's host on the local stack), not from counting
   `shared` rows: other suites can leave extra is_system rows behind. */
const SHARED_HOST = process.env.QA_DEFAULT_DOMAIN ?? new URL(REDIRECT_URL).host;

/** The newest /invite link mailed to `email` (MAIL_TRANSPORT=outbox in the API container). */
async function inviteLink(email: string): Promise<string> {
  const sanitized = email.replace(/[^a-z0-9]/gi, "_");
  for (let i = 0; i < 40; i++) {
    try {
      const { stdout } = await run("docker", [
        "exec", API_CONTAINER, "sh", "-c",
        `ls /tmp/snapurl-outbox/ 2>/dev/null | grep -F -- '-${sanitized}.txt' | sort -t- -k1,1 -n -r`,
      ]);
      for (const name of stdout.split("\n").filter(Boolean)) {
        const { stdout: body } = await run("docker", ["exec", API_CONTAINER, "cat", `/tmp/snapurl-outbox/${name}`]);
        const m = body.match(/(https?:\/\/\S+\/invite\?token=[^\s&]+)/);
        if (m) return m[1]!;
      }
    } catch {
      /* not written yet */
    }
    await new Promise((r) => setTimeout(r, 250));
  }
  throw new Error(`no /invite mail for ${email}`);
}

async function apiJson(token: string, path: string, init: RequestInit = {}) {
  const res = await fetch(`${API_URL}${path}`, {
    ...init,
    headers: { authorization: `Bearer ${token}`, "content-type": "application/json", ...(init.headers ?? {}) },
  });
  return { status: res.status, body: (await res.json().catch(() => null)) as any };
}

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
  let ownerWorkspaceId: string;
  const sharedHost = SHARED_HOST;

  test.beforeAll(async ({ browser }, testInfo) => {
    const email = makeEmail("j23");
    const session = await registerUser(email);
    token = session.accessToken;
    ownerWorkspaceId = session.workspaceId;

    const add = await fetch(`${API_URL}/domains`, {
      method: "POST",
      headers: { "content-type": "application/json", authorization: `Bearer ${token}` },
      body: JSON.stringify({ domain: host }),
    });
    expect(add.status, "POST /domains").toBe(201);

    const list = (await (await fetch(`${API_URL}/domains`, {
      headers: { authorization: `Bearer ${token}` },
    })).json()) as Array<{ domain: string; shared?: boolean }>;
    expect(list.find((d) => d.domain === sharedHost), `DEFAULT_DOMAIN ${sharedHost} is listed`).toMatchObject({ shared: true });

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

  /* #711 review, Minor-5: the API refuses a redirect change below admin
     (PATCH /domains/:id is @Roles("admin")), so the dashboard must not offer
     the control to an editor/viewer either.

     The API half of that oracle is asserted end-to-end here against the real
     stack: an invited editor, in the owner's workspace, is refused with 403.
     The UI half — that canEditDomainRedirects(role) gates the button, so an
     editor never sees it — is asserted deterministically in
     web/src/lib/domain-redirects.test.ts, which is wired to the exact same
     role rule the page uses. (Driving the dashboard across a workspace switch
     is not reliable enough to be an oracle: the SPA re-resolves the default
     workspace on navigation, so a cross-workspace membership flaps.) */
  test("the API refuses a redirect change by an editor (gate behind the hidden control)", async () => {
    const editorEmail = makeEmail("j23-editor");
    const invitee = await registerUser(editorEmail);
    // Fixture: accepting an invitation requires a verified email.
    const { stdout } = await run("docker", [
      "exec", DB_CONTAINER, "psql", "-U", "snapurl", "-d", "snapurl", "-At", "-c",
      `update users set email_verified_at = now() where lower(email) = lower('${editorEmail.replace(/'/g, "''")}') returning id`,
    ]);
    expect(stdout.trim(), "invitee email verified").not.toBe("");

    expect((await apiJson(token, "/members", { method: "POST", body: JSON.stringify({ email: editorEmail, role: "editor" }) })).status).toBe(201);
    const inviteToken = new URL(await inviteLink(editorEmail)).searchParams.get("token")!;
    expect((await apiJson(invitee.accessToken, "/auth/invite/accept", { method: "POST", body: JSON.stringify({ token: inviteToken }) })).status).toBe(200);

    // Enter the owner's workspace: a hinted refresh, exactly what the switcher does.
    const refreshed = await fetch(`${API_URL}/auth/refresh`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ refreshToken: invitee.refreshToken, workspaceId: ownerWorkspaceId }),
    });
    expect(refreshed.status, "switch to owner workspace").toBe(200);
    const editorToken = ((await refreshed.json()) as { accessToken: string }).accessToken;

    expect((await apiJson(editorToken, "/auth/me")).body.role, "editor in the owner's workspace").toBe("editor");
    const own = ((await apiJson(editorToken, "/domains")).body as Array<{ id: string; domain: string }>).find((d) => d.domain === host)!;
    expect(own, "editor sees the workspace's custom domain").toBeTruthy();
    // The gate: an editor cannot change redirects, so the UI hides the control.
    expect((await apiJson(editorToken, `/domains/${own.id}`, { method: "PATCH", body: JSON.stringify({ rootRedirect: null }) })).status).toBe(403);
    // And the row still carries the value an admin set — nothing was changed.
    expect(((await apiJson(editorToken, "/domains")).body as Array<{ id: string; notFoundRedirect: string | null }>).find((d) => d.id === own.id)!.notFoundRedirect).toBe(NOT_FOUND);
  });
});
