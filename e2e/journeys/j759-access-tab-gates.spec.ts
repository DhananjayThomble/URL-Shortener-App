/**
 * Journey 759 — Access tab: valid placeholders, and every switch-gated input follows its switch (#759)
 *
 * Before: the two "send visitors to" fields invited `acme.com/coming-soon` / `acme.com/offers`, which the
 * form then refused ("Enter an absolute http(s) URL"); and with its switch off only the Click limit input
 * was disabled — the dates and the two URLs stayed live, one tab with two conventions.
 *
 *   sign in -> New link -> Access -> every gated input disabled -> switch on -> type each placeholder
 *   VERBATIM -> Create -> the API stored exactly that and the redirect service sends a not-yet-live
 *   visitor to the scheduledTo URL
 *   Edit that link -> switch the expiry off -> Save -> the API holds no expiry and no expiresTo
 *   a scheme-less URL is refused while its switch is on, and stops mattering when the switch goes off
 *
 * Oracles:
 *   - The real POST/PATCH bodies the browser sends and what GET /links/:id persisted.
 *   - The redirect service's own answer (apps/redirect/src/main.ts: blocked "scheduled" -> scheduledTo).
 *   - packages/contract HttpUrl: the placeholder, as typed, is accepted by the API.
 *
 * Requires the local staging stack (api :3001, redirect :3002) built from this branch and the web app
 * on :3000 — see playwright.journeys.config.ts.
 */

import { expect, test, type Locator, type Page } from "@playwright/test";
import { API_URL, REDIRECT_URL, RUN_PASSWORD, makeEmail, registerUser, type Session } from "./helpers";

const DEST = "https://example.com/j759-destination";
const slugFor = (tag: string) => `j759-${tag}-${Math.random().toString(36).slice(2, 8)}`;
const auth = (s: Session) => ({ authorization: `Bearer ${s.accessToken}`, "content-type": "application/json" });

/** YYYY-MM-DD in the browser's local calendar, `days` from today. */
function dateInput(days: number): string {
  const d = new Date(Date.now() + days * 864e5);
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

async function signIn(page: Page, session: Session) {
  await page.goto("/login");
  await page.getByPlaceholder("you@company.com").fill(session.email);
  await page.getByPlaceholder("••••••••").fill(RUN_PASSWORD);
  await page.getByRole("button", { name: "Sign in" }).click();
  await expect(page).not.toHaveURL(/\/login/, { timeout: 20_000 });
}

async function api(session: Session, method: string, path: string, body?: object) {
  const res = await fetch(`${API_URL}${path}`, { method, headers: auth(session), body: body ? JSON.stringify(body) : undefined });
  return { status: res.status, body: (await res.json().catch(() => ({}))) as Record<string, any> };
}

async function getBySlug(session: Session, slug: string) {
  const list = await api(session, "GET", `/links?q=${encodeURIComponent(slug)}`);
  const items = (Array.isArray(list.body) ? list.body : (list.body.items ?? [])) as Record<string, any>[];
  const found = items.find((l) => l.slug === slug);
  expect(found, `link ${slug} should exist`).toBeTruthy();
  return found as Record<string, any>;
}

async function follow(slug: string) {
  const res = await fetch(`${REDIRECT_URL}/${slug}`, {
    redirect: "manual",
    headers: { "user-agent": "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/129.0 Safari/537.36" },
  });
  return { status: res.status, location: res.headers.get("location") };
}

const goLiveSwitch = (d: Locator) => d.getByRole("button", { name: /Go live on a date/ });
const expireSwitch = (d: Locator) => d.getByRole("button", { name: /Expire on a date/ });
const limitSwitch = (d: Locator) => d.getByRole("button", { name: /Expire after a click limit/ });
const goLiveDate = (d: Locator) => d.getByLabel("Go live on", { exact: true });
const scheduledTo = (d: Locator) => d.getByLabel("Until then, send visitors to");
const expiryDate = (d: Locator) => d.getByLabel("Expiry date", { exact: true });
const expiresTo = (d: Locator) => d.getByLabel("Then send visitors to");
const clickLimit = (d: Locator) => d.getByLabel("Click limit", { exact: true });
const allGated = [goLiveDate, scheduledTo, expiryDate, expiresTo, clickLimit];

async function setTheme(page: Page, mode: "light" | "dark") {
  await page.evaluate((m) => window.localStorage.setItem("snapurl.appearance", JSON.stringify({ mode: m })), mode);
  await page.reload();
  await expect(page.locator("html")).toHaveAttribute("data-theme", mode);
}

test.describe("Journey 759 — Access tab gates", () => {
  test("create: every gated input starts disabled; the placeholders, typed verbatim, are accepted and drive the redirect @mobile", async ({ page }) => {
    const session = await registerUser(makeEmail("j759a"));
    await signIn(page, session);
    await page.goto("/links");
    await page.getByRole("button", { name: /New link|Create a link/ }).first().click();
    const drawer = page.getByRole("dialog", { name: "Create a link" });
    await expect(drawer).toBeVisible();
    const slug = slugFor("new");
    await drawer.getByLabel("Destination URL").fill(DEST);
    await expect(drawer.getByLabel("Short-link domain")).not.toHaveValue("");
    await drawer.getByLabel("Short link").fill(slug);
    await drawer.getByRole("tab", { name: "Access", exact: true }).click();

    // 1. Everything that hangs off a switch is disabled, and says which switch to turn on.
    for (const f of allGated) await expect(f(drawer)).toBeDisabled();
    await expect(scheduledTo(drawer)).toHaveAttribute("placeholder", "Turn on the switch above");
    await expect(expiresTo(drawer)).toHaveAttribute("placeholder", "Turn on the switch above");
    await expect(clickLimit(drawer)).toHaveAttribute("placeholder", "Turn on the switch above");
    await drawer.screenshot({ path: test.info().outputPath("access-all-off-light.png") });

    // 2. Turn them on: the placeholders are real examples.
    await goLiveSwitch(drawer).click();
    await expireSwitch(drawer).click();
    await limitSwitch(drawer).click();
    for (const f of allGated) await expect(f(drawer)).toBeEnabled();
    const soon = (await scheduledTo(drawer).getAttribute("placeholder"))!;
    const gone = (await expiresTo(drawer).getAttribute("placeholder"))!;
    expect(soon).toMatch(/^https:\/\//);
    expect(gone).toMatch(/^https:\/\//);
    await drawer.screenshot({ path: test.info().outputPath("access-all-on-light.png") });

    // 3. Type them verbatim.
    await goLiveDate(drawer).fill(dateInput(3));
    await scheduledTo(drawer).fill(soon);
    await expiryDate(drawer).fill(dateInput(20));
    await expiresTo(drawer).fill(gone);
    await clickLimit(drawer).fill("25");

    const post = page.waitForResponse((r) => r.request().method() === "POST" && r.url().endsWith("/links"));
    await drawer.getByRole("button", { name: "Create link" }).click();
    const response = await post;
    expect(response.status(), await response.text()).toBe(201);
    const sent = JSON.parse(response.request().postData() ?? "{}") as Record<string, unknown>;
    expect(sent.scheduledTo).toBe(soon);
    expect(sent.expiresTo).toBe(gone);
    await expect(drawer).toBeHidden();

    const stored = await getBySlug(session, slug);
    expect(stored.scheduledTo).toBe(soon);
    expect(stored.expiresTo).toBe(gone);
    expect(stored.clickLimit).toBe(25);
    // The link is not live yet: a visitor is sent to the scheduledTo URL.
    await expect.poll(async () => (await follow(slug)).location, { timeout: 30_000 }).toBe(soon);
    expect((await follow(slug)).status).toBe(302);

    // 4. Dark theme: the same off/on states.
    await setTheme(page, "dark");
    await page.getByRole("button", { name: /New link|Create a link/ }).first().click();
    const dark = page.getByRole("dialog", { name: "Create a link" });
    await dark.getByRole("tab", { name: "Access", exact: true }).click();
    for (const f of allGated) await expect(f(dark)).toBeDisabled();
    await dark.screenshot({ path: test.info().outputPath("access-all-off-dark.png") });
    await goLiveSwitch(dark).click();
    await expireSwitch(dark).click();
    await limitSwitch(dark).click();
    await dark.screenshot({ path: test.info().outputPath("access-all-on-dark.png") });
  });

  test("a scheme-less URL is refused while its switch is on, and stops mattering when the switch goes off", async ({ page }) => {
    const session = await registerUser(makeEmail("j759b"));
    await signIn(page, session);
    await page.goto("/links");
    await page.getByRole("button", { name: /New link|Create a link/ }).first().click();
    const drawer = page.getByRole("dialog", { name: "Create a link" });
    const slug = slugFor("bare");
    await drawer.getByLabel("Destination URL").fill(DEST);
    await expect(drawer.getByLabel("Short-link domain")).not.toHaveValue("");
    await drawer.getByLabel("Short link").fill(slug);
    await drawer.getByRole("tab", { name: "Access", exact: true }).click();
    await expireSwitch(drawer).click();
    await expiresTo(drawer).fill("acme.com/offers"); // what the old placeholder invited

    const posts: string[] = [];
    page.on("request", (r) => {
      if (r.method() === "POST" && r.url().endsWith("/links")) posts.push(r.postData() ?? "");
    });
    await drawer.getByRole("button", { name: "Create link" }).click();
    await expect(expiresTo(drawer)).toHaveAttribute("aria-invalid", "true");
    await expect(drawer.getByText("Enter an absolute http(s) URL")).toBeVisible();
    expect(posts, "a refused URL must not reach the API").toHaveLength(0);

    await expireSwitch(drawer).click(); // the expiry is not wanted after all
    await expect(drawer.getByText("Enter an absolute http(s) URL")).toHaveCount(0);
    await expect(expiresTo(drawer)).toBeDisabled();
    const post = page.waitForResponse((r) => r.request().method() === "POST" && r.url().endsWith("/links"));
    await drawer.getByRole("button", { name: "Create link" }).click();
    expect((await post).status()).toBe(201);
    await expect(drawer).toBeHidden();

    const stored = await getBySlug(session, slug);
    expect(stored.expiresAt ?? null).toBeNull();
    expect(stored.expiresTo ?? null).toBeNull();
    expect((await follow(slug)).location).toBe(DEST);
  });

  test("edit: switching the expiry off removes the date AND its landing URL; on again restores nothing new on its own", async ({ page }) => {
    const session = await registerUser(makeEmail("j759c"));
    const slug = slugFor("edit");
    const ws = await api(session, "GET", "/workspaces/current");
    const expiresAt = new Date(Date.now() + 20 * 864e5).toISOString();
    const created = await api(session, "POST", "/links", {
      destination: DEST,
      domain: ws.body.defaultDomain ?? "localhost:3002",
      slug,
      expiresAt,
      expiresTo: "https://example.com/j759-gone",
    });
    expect(created.status, JSON.stringify(created.body)).toBe(201);
    const id = created.body.id as string;

    await signIn(page, session);
    await page.goto(`/links/${id}`);
    await page.getByRole("button", { name: "Edit", exact: true }).click();
    const drawer = page.getByRole("dialog", { name: new RegExp(`Edit .+/${slug}`) });
    await expect(drawer).toBeVisible();
    await drawer.getByRole("tab", { name: "Access", exact: true }).click();

    await expect(expiryDate(drawer)).toBeEnabled();
    await expect(expiresTo(drawer)).toHaveValue("https://example.com/j759-gone");
    await expect(goLiveDate(drawer)).toBeDisabled();
    await expect(scheduledTo(drawer)).toBeDisabled();
    await expect(clickLimit(drawer)).toBeDisabled();

    // off and on again: the link's own expiry and URL come back, not a new default
    const before = await expiryDate(drawer).inputValue();
    await expireSwitch(drawer).click();
    await expect(expiryDate(drawer)).toBeDisabled();
    await expect(expiryDate(drawer)).toHaveValue("");
    await expireSwitch(drawer).click();
    await expect(expiryDate(drawer)).toHaveValue(before);
    await expect(expiresTo(drawer)).toHaveValue("https://example.com/j759-gone");

    // off for good, save
    await expireSwitch(drawer).click();
    const patch = page.waitForResponse((r) => r.request().method() === "PATCH" && r.url().endsWith(`/links/${id}`));
    await drawer.getByRole("button", { name: "Save changes" }).click();
    expect((await patch).status()).toBe(200);
    await expect(drawer).toBeHidden();

    const stored = await api(session, "GET", `/links/${id}`);
    expect(stored.body.expiresAt ?? null).toBeNull();
    expect(stored.body.expiresTo ?? null).toBeNull();
    expect((await follow(slug)).location).toBe(DEST);
  });
});
