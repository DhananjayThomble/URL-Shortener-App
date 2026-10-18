/**
 * Journey 25 — the workspace "Default redirect type" reaches new links (#753)
 *
 * Before #753 the setting saved and read back fine but did nothing: the New
 * link drawer preselected 302, Bulk create sent "302" on every row, and the
 * API's contract filled 302 for any create that omitted redirectType.
 *
 * A real user does this:
 *   sign in -> Settings -> Default redirect type 301 -> Save -> reload
 *   -> New link -> Routing tab (301 preselected) -> Create link
 *   -> Bulk create two rows -> every new link answers 301 on the redirect service.
 *
 * Oracles (independent of the implementation):
 *   - The Settings copy: "Applies to new links. Any link can override it."
 *   - GET /workspaces/current (defaultRedirect) and GET /links/:id
 *     (redirectType) — read back, never assumed.
 *   - The real POST /links / POST /links/bulk request bodies.
 *   - The redirect service on :3002: the HTTP status a visitor actually gets.
 *
 * Requires the local staging stack (api :3001, redirect :3002, postgres :5435)
 * and the web app on :3000 — see playwright.journeys.config.ts.
 */

import { expect, test, type Browser, type Page, type Request } from "@playwright/test";
import { API_URL, REDIRECT_URL, RUN_PASSWORD, makeEmail, registerUser, type Session } from "./helpers";

interface LinkDto {
  id: string;
  slug: string;
  domain: string;
  destination: string;
  redirectType: string;
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

async function signIn(page: Page, session: Session) {
  await page.goto("/login");
  await page.getByPlaceholder("you@company.com").fill(session.email);
  await page.getByPlaceholder("••••••••").fill(RUN_PASSWORD);
  await page.getByRole("button", { name: "Sign in" }).click();
  await expect(page).not.toHaveURL(/\/login/, { timeout: 20_000 });
}

/** What a visitor gets: the redirect service's status for <host>/<slug>. */
async function visit(link: LinkDto) {
  const res = await fetch(`${REDIRECT_URL}/${link.slug}`, {
    redirect: "manual",
    headers: { "x-forwarded-host": link.domain },
  });
  return { status: res.status, location: res.headers.get("location") ?? "" };
}

async function openNewLink(page: Page) {
  // Desktop sidebar has a "＋ New link" button; the mobile top bar has a
  // "Create a link" (＋) button in the banner. Try whichever is present.
  const create = page.getByRole("button", { name: "Create a link" });
  if (await create.isVisible().catch(() => false)) {
    await create.click();
  } else {
    const menu = page.getByRole("button", { name: "Open navigation menu" });
    if (await menu.isVisible().catch(() => false)) await menu.click();
    await page.getByRole("button", { name: /New link/ }).filter({ visible: true }).first().click();
  }
  const drawer = page.getByRole("dialog", { name: "Create a link" });
  await expect(drawer).toBeVisible();
  return drawer;
}

/** The Destination URL field (link-form-fields.tsx) has no programmatic label. */
const DEST_PLACEHOLDER = "https://acme.com/collections/spring-2026";

const isPost = (suffix: RegExp) => (r: Request) => r.method() === "POST" && suffix.test(r.url());

test.describe("Journey 25 — workspace default redirect type applies to new links (#753) @mobile", () => {
  test.describe.configure({ mode: "serial" });
  let session: Session;
  let page: Page;

  test.beforeAll(async ({ browser }: { browser: Browser }) => {
    session = await registerUser(makeEmail("j25"));
    const ws = await api<{ defaultRedirect: string }>(session, "/workspaces/current");
    expect(ws.defaultRedirect, "precondition: a new workspace starts on 302").toBe("302");
    // The project's device (desktop, or 390px mobile), which browser.newPage() would not apply.
    const { viewport, userAgent, isMobile, hasTouch, deviceScaleFactor, baseURL } = test.info().project.use;
    page = await (await browser.newContext({ viewport, userAgent, isMobile, hasTouch, deviceScaleFactor, baseURL })).newPage();
    await signIn(page, session);
  });
  test.afterAll(async () => {
    await page.context().close();
  });

  test("(a) Settings: choose 301, save, and it survives a reload", async () => {
    await page.goto("/settings");
    const group = page.getByRole("group", { name: "Default redirect type" });
    await group.getByRole("button", { name: "301", exact: true }).click();
    await page.getByRole("button", { name: "Save changes" }).click();
    await expect(page.getByText("Saved.")).toBeVisible();
    await page.reload();
    await expect(page.getByRole("group", { name: "Default redirect type" }).getByRole("button", { name: "301", exact: true })).toHaveAttribute(
      "aria-pressed",
      "true",
    );
    expect((await api<{ defaultRedirect: string }>(session, "/workspaces/current")).defaultRedirect).toBe("301");
  });

  test("(b) New link drawer preselects 301 and the created link answers 301", async () => {
    await page.goto("/links");
    const drawer = await openNewLink(page);
    await drawer.getByPlaceholder(DEST_PLACEHOLDER).fill("https://example.com/j25-drawer");
    await drawer.getByRole("tab", { name: "Routing" }).click();
    const group = drawer.getByRole("group", { name: "Redirect type" });
    await expect(group.getByRole("button", { name: "301", exact: true })).toHaveAttribute("aria-pressed", "true");
    await expect(group.getByRole("button", { name: "302", exact: true })).toHaveAttribute("aria-pressed", "false");

    const [req] = await Promise.all([page.waitForRequest(isPost(/\/links$/)), drawer.getByRole("button", { name: "Create link" }).click()]);
    expect((req.postDataJSON() as { redirectType?: string }).redirectType).toBe("301");
    const res = await req.response();
    const created = (await res!.json()) as LinkDto;
    await expect(drawer).toBeHidden();

    const stored = await api<LinkDto>(session, `/links/${created.id}`);
    expect(stored.redirectType).toBe("301");
    const hit = await visit(stored);
    expect(hit.status).toBe(301);
    expect(hit.location).toBe("https://example.com/j25-drawer");
  });

  test("(c) an explicit choice in the drawer still wins (307)", async () => {
    await page.goto("/links");
    const drawer = await openNewLink(page);
    await drawer.getByPlaceholder(DEST_PLACEHOLDER).fill("https://example.com/j25-explicit");
    await drawer.getByRole("tab", { name: "Routing" }).click();
    await drawer.getByRole("group", { name: "Redirect type" }).getByRole("button", { name: "307", exact: true }).click();
    const [req] = await Promise.all([page.waitForRequest(isPost(/\/links$/)), drawer.getByRole("button", { name: "Create link" }).click()]);
    const created = (await (await req.response())!.json()) as LinkDto;
    expect((await api<LinkDto>(session, `/links/${created.id}`)).redirectType).toBe("307");
    expect((await visit(created)).status).toBe(307);
  });

  test("(d) Bulk create: every row gets 301 and answers 301", async () => {
    await page.goto("/links");
    await page.getByRole("button", { name: "Bulk create" }).click();
    await page.getByLabel("One link per line").fill("https://example.com/j25-bulk-a\nhttps://example.com/j25-bulk-b");
    const [req] = await Promise.all([
      page.waitForRequest(isPost(/\/links\/bulk$/)),
      page.getByRole("button", { name: "Create 2 links" }).click(),
    ]);
    for (const row of (req.postDataJSON() as { links: Record<string, unknown>[] }).links) {
      expect(row).not.toHaveProperty("redirectType");
    }
    const body = (await (await req.response())!.json()) as { created: number; results: Array<{ ok: boolean; link?: LinkDto }> };
    expect(body.created).toBe(2);
    await expect(page.getByText("2 created.")).toBeVisible();
    for (const r of body.results) {
      expect(r.ok).toBe(true);
      const stored = await api<LinkDto>(session, `/links/${r.link!.id}`);
      expect(stored.redirectType).toBe("301");
      expect((await visit(stored)).status).toBe(301);
    }
  });

  test("(e) API: an omitted redirectType stores the workspace default, an explicit one wins", async () => {
    const ws = await api<{ defaultDomain: string }>(session, "/workspaces/current");
    const omitted = await api<LinkDto>(session, "/links", {
      method: "POST",
      body: JSON.stringify({ destination: "https://example.com/j25-api", domain: ws.defaultDomain }),
    });
    expect(omitted.redirectType).toBe("301");
    const explicit = await api<LinkDto>(session, "/links", {
      method: "POST",
      body: JSON.stringify({ destination: "https://example.com/j25-api-302", domain: ws.defaultDomain, redirectType: "302" }),
    });
    expect(explicit.redirectType).toBe("302");
    expect((await visit(explicit)).status).toBe(302);
  });
});
