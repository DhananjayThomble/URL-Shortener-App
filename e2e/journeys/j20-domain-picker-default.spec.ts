/**
 * Journey 20 — The domain picker starts on a live domain (#651)
 *
 * Before #651 the New link drawer (and the bio-page editor) defaulted to
 * `domains[0]`. The list puts a workspace's own custom domains ahead of the
 * shared one, so a custom domain still "Verifying DNS" was pre-selected and
 * "Create link" failed with a 400 ("... isn't verified yet ...").
 *
 * A real user does this:
 *   sign in -> (workspace has a pending custom domain and a verified one)
 *   -> New link -> fill destination + slug -> Create link.
 *
 * Oracles (independent of the implementation):
 *   - Issue #651 / the /domains copy "Nothing resolves until it verifies":
 *     the default is the workspace's defaultDomain when verified; a domain that
 *     is still verifying is labelled and cannot be chosen for a link.
 *   - GET /workspaces/current (defaultDomain) and GET /domains (status) for the
 *     expected values — read back, never hardcoded.
 *   - The real POST /links request/response, and the redirect service on :3002
 *     (the Host the link was created on, via x-forwarded-host).
 *   - Bio-page publishing on an unverified domain is deliberately UNCHANGED
 *     (decision pending in #650): the bio picker marks, it does not block.
 *
 * Requires the local staging stack (api :3001, redirect :3002, postgres :5435)
 * and the web app on :3000 — see playwright.journeys.config.ts.
 */

import { execFileSync } from "node:child_process";
import { expect, test, type Browser, type Page, type Request } from "@playwright/test";
import { API_URL, REDIRECT_URL, RUN_ID, RUN_PASSWORD, makeEmail, registerUser, type Session } from "./helpers";

const DEST = "https://example.com/j20-destination";
const slugFor = (tag: string) => `j20-${tag}-${Math.random().toString(36).slice(2, 8)}`;
const isCreatePost = (r: Request) => r.method() === "POST" && /\/links$/.test(r.url());

const DB_URL = process.env.DATABASE_URL ?? "postgres://snapurl:snapurl@localhost:5435/snapurl";

interface DomainRow {
  id: string;
  domain: string;
  status: string;
}

async function api<T>(session: Session, path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`${API_URL}${path}`, {
    ...init,
    headers: { authorization: `Bearer ${session.accessToken}`, "content-type": "application/json" },
  });
  const text = await res.text();
  if (!res.ok) throw new Error(`${init?.method ?? "GET"} ${path} -> ${res.status}; ${text.slice(0, 300)}`);
  return JSON.parse(text) as T;
}

/** Real sign-in through the login form, as a user would. */
async function signIn(page: Page, session: Session) {
  await page.goto("/login");
  await page.getByPlaceholder("you@company.com").fill(session.email);
  await page.getByPlaceholder("••••••••").fill(RUN_PASSWORD);
  await page.getByRole("button", { name: "Sign in" }).click();
  await expect(page).not.toHaveURL(/\/login/, { timeout: 20_000 });
}

async function visit(host: string | null, slug: string) {
  const res = await fetch(`${REDIRECT_URL}/${slug}`, {
    redirect: "manual",
    headers: host ? { "x-forwarded-host": host } : {},
  });
  return { status: res.status, location: res.headers.get("location") ?? "" };
}

test.describe("Journey 20 — domain picker default (#651)", () => {
  test.describe.configure({ mode: "serial" });
  let session: Session;
  let page: Page;
  let defaultDomain: string;
  let pending: DomainRow;
  let verified: DomainRow;

  test.beforeAll(async ({ browser }: { browser: Browser }) => {
    session = await registerUser(makeEmail("j20"));

    const ws = await api<{ defaultDomain: string }>(session, "/workspaces/current");
    defaultDomain = ws.defaultDomain;

    // Created FIRST so it sorts first among the workspace's own domains — the
    // position the old `domains[0]` default picked.
    pending = await api<DomainRow>(session, "/domains", {
      method: "POST",
      body: JSON.stringify({ domain: `pending-${RUN_ID}.j20-example.test` }),
    });
    verified = await api<DomainRow>(session, "/domains", {
      method: "POST",
      body: JSON.stringify({ domain: `verified-${RUN_ID}.j20-example.test` }),
    });
    // DNS verification cannot run locally; mark the second domain verified in
    // the staging DB exactly as the verify endpoint would.
    execFileSync(
      "psql",
      [DB_URL, "-v", "ON_ERROR_STOP=1", "-c", `update domains set status='live', ssl='active', verified_at=now() where id='${verified.id}'`],
      { stdio: "pipe" },
    );

    // Independent read of the precondition: one pending, one live, in that order.
    const list = await api<DomainRow[]>(session, "/domains");
    const own = list.filter((d) => d.id === pending.id || d.id === verified.id);
    expect(own.map((d) => d.status), "precondition: [pending, verified] among own domains").toEqual(["verifying", "live"]);
    expect(list[0]?.id, "precondition: the pending domain sorts first (old default)").toBe(pending.id);

    page = await browser.newPage();
    await signIn(page, session);
  });
  test.afterAll(async () => {
    await page.close();
  });

  test("(a) New link defaults to the workspace default domain, not the pending one", async () => {
    await page.goto("/links");
    await page.getByRole("button", { name: /New link/ }).first().click();
    const drawer = page.getByRole("dialog", { name: "Create a link" });
    await expect(drawer).toBeVisible();

    const select = drawer.getByLabel("Short-link domain");
    await expect(select).toHaveValue(defaultDomain);
    expect(await select.inputValue()).not.toBe(pending.domain);
  });

  test("(b) the pending domain is labelled and cannot be chosen; the verified one can", async () => {
    const drawer = page.getByRole("dialog", { name: "Create a link" });
    const select = drawer.getByLabel("Short-link domain");

    const pendingOpt = select.locator(`option[value="${pending.domain}"]`);
    await expect(pendingOpt).toHaveText(`${pending.domain} — verifying`);
    await expect(pendingOpt).toBeDisabled();

    const verifiedOpt = select.locator(`option[value="${verified.domain}"]`);
    await expect(verifiedOpt).toHaveText(verified.domain);
    await expect(verifiedOpt).toBeEnabled();

    // Selecting it is refused by the control itself: value is unchanged.
    await select.selectOption(pending.domain, { timeout: 2_000 }).catch(() => undefined);
    await expect(select).toHaveValue(defaultDomain);
  });

  test("(c) Create link on the default domain succeeds and the redirect works", async () => {
    const drawer = page.getByRole("dialog", { name: "Create a link" });
    const slug = slugFor("def");
    await drawer.getByLabel("Destination URL").fill(DEST);
    await drawer.getByLabel("Short link").fill(slug);

    const post = page.waitForRequest(isCreatePost, { timeout: 15_000 });
    const resp = page.waitForResponse((r) => isCreatePost(r.request()), { timeout: 15_000 });
    await drawer.getByRole("button", { name: "Create link" }).click();
    expect(((await post).postDataJSON() as { domain: string }).domain).toBe(defaultDomain);
    expect((await resp).status(), "POST /links status").toBe(201);

    await expect(drawer).toBeHidden({ timeout: 15_000 });
    const hit = await visit(null, slug);
    expect(hit.status).toBe(302);
    expect(hit.location).toBe(DEST);
  });

  test("(d) choosing the verified custom domain creates a link that redirects on that host", async () => {
    await page.goto("/links");
    await page.getByRole("button", { name: /New link/ }).first().click();
    const drawer = page.getByRole("dialog", { name: "Create a link" });
    await expect(drawer).toBeVisible();

    const slug = slugFor("cus");
    await drawer.getByLabel("Destination URL").fill(DEST);
    await drawer.getByLabel("Short-link domain").selectOption(verified.domain);
    await drawer.getByLabel("Short link").fill(slug);

    const resp = page.waitForResponse((r) => isCreatePost(r.request()), { timeout: 15_000 });
    await drawer.getByRole("button", { name: "Create link" }).click();
    expect((await resp).status(), "POST /links status").toBe(201);
    await expect(drawer).toBeHidden({ timeout: 15_000 });

    const hit = await visit(verified.domain, slug);
    expect(hit.status).toBe(302);
    expect(hit.location).toBe(DEST);
  });

  test("(e) Bio page editor: default is the live domain, pending one is labelled (not blocked)", async () => {
    await page.goto("/bio");
    await page.getByRole("button", { name: /New page/ }).click();
    const select = page.locator("select").filter({ has: page.locator(`option[value="${pending.domain}"]`) }).first();
    await expect(select).toBeVisible({ timeout: 15_000 });
    await expect(select).toHaveValue(defaultDomain);
    await expect(select.locator(`option[value="${pending.domain}"]`)).toHaveText(`${pending.domain} — verifying`);
    // #650 is undecided: the option stays selectable, so the policy is unchanged.
    await expect(select.locator(`option[value="${pending.domain}"]`)).toBeEnabled();
  });
});
