/**
 * Journey 14 — Visiting the Access tab must not break "Create link" (#645)
 *
 * Before #645, opening the Access tab mounted two uncontrolled URL inputs
 * (`scheduledTo`, `expiresTo`) that read back as "" — and CreateLinkInput
 * rejects "" for an HttpUrl. The submit was swallowed: no POST, no error text,
 * and the broken state survived Cancel -> reopen. A real user does this:
 *
 *   sign in through the login form -> New link -> fill destination + slug ->
 *   glance at the Access tab (type nothing) -> Create link.
 *
 * Oracles:
 *   - packages/contract/src/link.ts CreateLinkInput: every Access field is
 *     optional; a bad URL must be rejected AND shown.
 *   - The real POST /links request (waitForRequest) and its response.
 *   - GET /links/:id and the redirect service on :3002 (independent reads).
 *
 * Requires the local staging stack (api :3001, redirect :3002) and the web app
 * on :3000 — see playwright.journeys.config.ts.
 */

import { expect, test, type Locator, type Page, type Request } from "@playwright/test";
import { API_URL, REDIRECT_URL, RUN_PASSWORD, makeEmail, registerUser, type Session } from "./helpers";

const DEST = "https://example.com/j14-destination";
const SCHEDULED_TO = "https://example.com/j14-coming-soon";
const EXPIRES_TO = "https://example.com/j14-expired-landing";

const slugFor = (tag: string) => `j14-${tag}-${Math.random().toString(36).slice(2, 8)}`;

/** YYYY-MM-DD in the browser's local calendar, `days` from today. */
function dateInput(days: number): string {
  const d = new Date(Date.now() + days * 864e5);
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

/** Real sign-in through the login form, as a user would. */
async function signIn(page: Page, session: Session) {
  await page.goto("/login");
  await page.getByPlaceholder("you@company.com").fill(session.email);
  await page.getByPlaceholder("••••••••").fill(RUN_PASSWORD);
  await page.getByRole("button", { name: "Sign in" }).click();
  await expect(page).not.toHaveURL(/\/login/, { timeout: 20_000 });
}

async function openCreate(page: Page): Promise<Locator> {
  await page.goto("/links");
  await page.getByRole("button", { name: /New link/ }).first().click();
  const drawer = page.getByRole("dialog", { name: "Create a link" });
  await expect(drawer).toBeVisible();
  return drawer;
}

async function fillBasics(drawer: Locator, slug: string) {
  await drawer.getByLabel("Destination URL").fill(DEST);
  // The back-half domain defaults to the workspace's own first domain once loaded.
  await expect(drawer.getByLabel("Short-link domain")).not.toHaveValue("");
  await drawer.getByLabel("Short link").fill(slug);
}

const tab = (drawer: Locator, name: string) => drawer.getByRole("tab", { name, exact: true }).click();
const isCreatePost = (r: Request) => r.method() === "POST" && /\/links$/.test(r.url());

async function getBySlug(session: Session, slug: string) {
  const res = await fetch(`${API_URL}/links?q=${encodeURIComponent(slug)}`, {
    headers: { authorization: `Bearer ${session.accessToken}` },
  });
  expect(res.ok, "GET /links should succeed").toBe(true);
  const body = (await res.json()) as { items?: Record<string, any>[] } | Record<string, any>[];
  const items = Array.isArray(body) ? body : (body.items ?? []);
  const found = items.find((l) => l.slug === slug);
  expect(found, `link ${slug} should exist`).toBeTruthy();
  return found as Record<string, any>;
}

async function visit(slug: string) {
  const res = await fetch(`${REDIRECT_URL}/${slug}`, { redirect: "manual" });
  return { status: res.status, location: res.headers.get("location") ?? "" };
}

test.describe("Journey 14 — Create link after visiting the Access tab", () => {
  test("(a) visit Access, type nothing, Create -> POST is sent, link listed and redirects", async ({ page }) => {
    const session = await registerUser(makeEmail("j14a"));
    await signIn(page, session);
    const drawer = await openCreate(page);
    const slug = slugFor("a");
    await fillBasics(drawer, slug);

    await tab(drawer, "Access");
    await expect(drawer.getByPlaceholder("acme.com/offers")).toBeVisible(); // the tab really mounted

    const post = page.waitForRequest(isCreatePost, { timeout: 15_000 });
    await drawer.getByRole("button", { name: "Create link" }).click();
    const body = (await post).postDataJSON() as Record<string, unknown>;
    // Untouched optional fields are absent/null on the wire — never "".
    for (const key of ["expiresTo", "scheduledTo", "password", "activatesAt", "expiresAt"]) {
      expect(body[key] === undefined || body[key] === null, `${key} must not be sent as "${String(body[key])}"`).toBe(true);
    }

    await expect(drawer).toBeHidden({ timeout: 15_000 });
    await expect(page.getByText(slug).first()).toBeVisible();
    const stored = await getBySlug(session, slug);
    expect(stored.destination).toBe(DEST);
    const hit = await visit(slug);
    expect(hit.status).toBe(302);
    expect(hit.location).toBe(DEST);
  });

  test("(b) Cancel, reopen without touching Access -> Create still works, and the form was reset", async ({ page }) => {
    const session = await registerUser(makeEmail("j14b"));
    await signIn(page, session);

    let drawer = await openCreate(page);
    await fillBasics(drawer, slugFor("b0"));
    await tab(drawer, "Access");
    await drawer.getByPlaceholder("acme.com/offers").fill("not a url");
    await drawer.getByRole("button", { name: "Cancel" }).click();
    await expect(drawer).toBeHidden();

    // Reopen: nothing from the abandoned attempt may leak into the new one.
    drawer = page.getByRole("dialog", { name: "Create a link" });
    await page.getByRole("button", { name: /New link/ }).first().click();
    await expect(drawer).toBeVisible();
    await expect(drawer.getByLabel("Destination URL")).toHaveValue("");
    await tab(drawer, "Access");
    await expect(drawer.getByPlaceholder("acme.com/offers")).toHaveValue("");
    await tab(drawer, "Destination");

    const slug = slugFor("b");
    await fillBasics(drawer, slug);
    const post = page.waitForRequest(isCreatePost, { timeout: 15_000 });
    await drawer.getByRole("button", { name: "Create link" }).click();
    await post;
    await expect(drawer).toBeHidden({ timeout: 15_000 });
    await expect(page.getByText(slug).first()).toBeVisible();
    expect((await visit(slug)).location).toBe(DEST);
  });

  test("(c) an invalid fallback URL on Access shows an error on that tab and sends no POST", async ({ page }) => {
    const session = await registerUser(makeEmail("j14c"));
    await signIn(page, session);
    const drawer = await openCreate(page);
    const slug = slugFor("c");
    await fillBasics(drawer, slug);

    await tab(drawer, "Access");
    await drawer.getByPlaceholder("acme.com/offers").fill("not a url");

    let posted = false;
    page.on("request", (r) => {
      if (isCreatePost(r)) posted = true;
    });
    await drawer.getByRole("button", { name: "Create link" }).click();

    // Field-level error on the Access tab...
    const field = drawer.getByPlaceholder("acme.com/offers");
    await expect(field).toHaveAttribute("aria-invalid", "true");
    await expect(drawer.getByText("Enter an absolute http(s) URL")).toBeVisible();
    // ...and a dialog-level message that names the tab, even from another tab.
    await tab(drawer, "Destination");
    const summary = drawer.getByRole("alert");
    await expect(summary).toContainText("Access");
    await expect(drawer.getByRole("tab", { name: /Access/ })).toHaveAttribute("data-invalid", "true");
    // The summary is actionable: it takes the user to the offending tab.
    await summary.getByRole("button", { name: /Access/ }).click();
    await expect(field).toBeVisible();

    await page.waitForTimeout(500);
    expect(posted, "an invalid form must not POST").toBe(false);
    const list = await fetch(`${API_URL}/links?q=${slug}`, { headers: { authorization: `Bearer ${session.accessToken}` } });
    expect(JSON.stringify(await list.json())).not.toContain(slug);

    // Fixing the value lets the same dialog submit.
    await field.fill(EXPIRES_TO);
    const post = page.waitForRequest(isCreatePost, { timeout: 15_000 });
    await drawer.getByRole("button", { name: "Create link" }).click();
    await post;
    await expect(drawer).toBeHidden({ timeout: 15_000 });
  });

  test("(d) valid scheduled / expiry values on Access are carried by the created link", async ({ page }) => {
    const session = await registerUser(makeEmail("j14d"));
    await signIn(page, session);
    const drawer = await openCreate(page);
    const slug = slugFor("d");
    await fillBasics(drawer, slug);

    await tab(drawer, "Access");
    await drawer.getByRole("button", { name: /Go live on a date/ }).click();
    await drawer.getByLabel("Go live on").fill(dateInput(5));
    await drawer.getByPlaceholder("acme.com/coming-soon").fill(SCHEDULED_TO);
    await drawer.getByRole("button", { name: /Expire on a date/ }).click();
    await drawer.getByLabel("Expiry date").fill(dateInput(20));
    await drawer.getByPlaceholder("acme.com/offers").fill(EXPIRES_TO);

    const post = page.waitForRequest(isCreatePost, { timeout: 15_000 });
    await drawer.getByRole("button", { name: "Create link" }).click();
    const body = (await post).postDataJSON() as Record<string, any>;
    expect(body.scheduledTo).toBe(SCHEDULED_TO);
    expect(body.expiresTo).toBe(EXPIRES_TO);
    await expect(drawer).toBeHidden({ timeout: 15_000 });

    const stored = await getBySlug(session, slug);
    expect(stored.scheduledTo).toBe(SCHEDULED_TO);
    expect(stored.expiresTo).toBe(EXPIRES_TO);
    expect(stored.activatesAt, "go-live date should be stored").toBeTruthy();
    expect(stored.expiresAt, "expiry date should be stored").toBeTruthy();
    // Visitor-visible effect: the link is not live yet, so it sends visitors to the scheduled landing page.
    const hit = await visit(slug);
    expect(hit.status).toBe(302);
    expect(hit.location).toBe(SCHEDULED_TO);
  });
});
