/**
 * Journey 754 — An expiry date in the past is refused, and an expired link stays editable (#754)
 *
 * Before: New link -> Access -> "Expire on a date" -> a past day -> Create made a link that was
 * expired from birth (listed as "Expired", the short URL a 410 from its first click), and the API
 * accepted the same past date on POST /links, POST /links/bulk and PATCH /links/:id.
 *
 *   sign in -> New link -> Access -> expiry on -> pick yesterday -> refused inline, nothing posted
 *   -> pick today -> Create -> (API read: not expired) -> follow the short URL: 302 to the destination
 *   a link that expires a few seconds later -> wait until it HAS expired -> Edit -> change the
 *   destination (expiry untouched) -> Save works -> pick another past day -> refused -> pick a future
 *   day -> Save -> the short URL redirects again
 *   and the API refuses a past expiry itself, with the same words.
 *
 * Oracles:
 *   - The real POST/PATCH bodies the browser sends (waitForRequest / no request at all).
 *   - GET /links/:id over HTTP (what was persisted) and the redirect service's own answer.
 *   - packages/domain/src/expiry.ts validateExpiry: an expiry at or before "now" is already expired
 *     (deriveStatus); only a CHANGED expiry is judged on edit.
 *
 * Requires the local staging stack (api :3001, redirect :3002) built from this branch and the
 * web app on :3000 — see playwright.journeys.config.ts.
 */

import { expect, test, type Locator, type Page } from "@playwright/test";
import { API_URL, REDIRECT_URL, RUN_PASSWORD, makeEmail, registerUser, type Session } from "./helpers";

const TZ = "Asia/Kolkata";
const DAY = 86_400_000;
const PAST = /already passed/;
const DEST = "https://example.com/j754-destination";

const slugFor = (tag: string) => `j754-${tag}-${Math.random().toString(36).slice(2, 8)}`;
const dayIn = (at: number) => new Intl.DateTimeFormat("en-CA", { timeZone: TZ }).format(new Date(at));
const auth = (s: Session) => ({ authorization: `Bearer ${s.accessToken}`, "content-type": "application/json" });

async function signIn(page: Page, session: Session) {
  await page.goto("/login");
  await page.getByPlaceholder("you@company.com").fill(session.email);
  await page.getByPlaceholder("••••••••").fill(RUN_PASSWORD);
  await page.getByRole("button", { name: "Sign in" }).click();
  await expect(page).not.toHaveURL(/\/login/, { timeout: 20_000 });
}

async function api(session: Session, method: string, path: string, body?: object) {
  const res = await fetch(`${API_URL}${path}`, { method, headers: auth(session), body: body ? JSON.stringify(body) : undefined });
  return { status: res.status, body: (await res.json().catch(() => ({}))) as Record<string, unknown> };
}

async function domainOf(session: Session) {
  const ws = await api(session, "GET", "/workspaces/current");
  return (ws.body.defaultDomain as string | undefined) ?? "localhost:3002";
}

/** The redirect service's answer for a short link, not following it. */
async function follow(slug: string) {
  const res = await fetch(`${REDIRECT_URL}/${slug}`, {
    redirect: "manual",
    headers: { "user-agent": "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/129.0 Safari/537.36" },
  });
  return { status: res.status, location: res.headers.get("location") };
}

const expiryInput = (drawer: Locator) => drawer.getByLabel("Expiry date", { exact: true });
const expiryToggle = (drawer: Locator) => drawer.getByRole("button", { name: /Expire on a date/ });

async function errorText(input: Locator): Promise<string | null> {
  const id = await input.getAttribute("aria-describedby");
  return id ? input.page().locator(`[id="${id}"]`).textContent() : null;
}

test.describe("Journey 754 — past expiry dates", () => {
  test.use({ timezoneId: TZ });

  test("create: yesterday is refused inline and never posted; today creates a working link @mobile", async ({ page }) => {
    const session = await registerUser(makeEmail("j754a"));
    await signIn(page, session);
    const posts: string[] = [];
    page.on("request", (r) => {
      if (r.method() === "POST" && r.url().endsWith("/links")) posts.push(r.postData() ?? "");
    });

    await page.goto("/links");
    await page.getByRole("button", { name: /New link|Create a link/ }).first().click();
    const drawer = page.getByRole("dialog", { name: "Create a link" });
    await expect(drawer).toBeVisible();
    const slug = slugFor("new");
    await drawer.getByLabel("Destination URL").fill(DEST);
    await drawer.getByLabel("Short link").fill(slug);
    await drawer.getByRole("tab", { name: "Access", exact: true }).click();
    await expiryToggle(drawer).click();

    await expiryInput(drawer).fill(dayIn(Date.now() - DAY));
    await expect(expiryInput(drawer)).toHaveAttribute("aria-invalid", "true");
    expect(await errorText(expiryInput(drawer))).toMatch(PAST);
    await drawer.getByRole("button", { name: "Create link" }).click();
    await expect(drawer).toBeVisible();
    await page.waitForTimeout(500);
    expect(posts, "a refused date must not reach the API").toHaveLength(0);
    await page.screenshot({ path: test.info().outputPath("create-refused.png") });

    const today = dayIn(Date.now());
    await expiryInput(drawer).fill(today);
    expect(await errorText(expiryInput(drawer))).toBeNull();
    const post = page.waitForResponse((r) => r.request().method() === "POST" && r.url().endsWith("/links"));
    await drawer.getByRole("button", { name: "Create link" }).click();
    const response = await post;
    expect(response.status()).toBe(201);
    const sent = JSON.parse(response.request().postData() ?? "{}") as { expiresAt: string };
    await expect(drawer).toBeHidden();
    expect(Date.parse(sent.expiresAt)).toBeGreaterThan(Date.now());

    const createdId = ((await response.json()) as { id: string }).id;
    const created = (await api(session, "GET", `/links/${createdId}`)).body;
    expect(created.slug).toBe(slug);
    expect(created.status).not.toBe("expired");
    expect(created.expiresAt).toBe(sent.expiresAt);
    await expect.poll(async () => follow(slug), { message: "new link -> 302 to its destination", timeout: 30_000 }).toEqual({ status: 302, location: DEST });
  });

  test("edit: an expired link stays editable; a different past day is refused; a future day revives it @mobile", async ({ page }) => {
    const session = await registerUser(makeEmail("j754b"));
    const domain = await domainOf(session);
    const slug = slugFor("exp");
    const made = await api(session, "POST", "/links", { destination: DEST, domain, slug, expiresAt: new Date(Date.now() + 4_000).toISOString() });
    expect(made.status).toBe(201);
    const id = made.body.id as string;
    // Let it expire for real.
    await expect.poll(async () => (await api(session, "GET", `/links/${id}`)).body.status, { timeout: 20_000 }).toBe("expired");
    await expect.poll(async () => (await follow(slug)).status, { message: "expired -> 410", timeout: 30_000 }).toBe(410);

    await signIn(page, session);
    await page.goto(`/links/${id}`);
    await page.getByRole("button", { name: "Edit", exact: true }).click();
    const drawer = page.getByRole("dialog", { name: new RegExp(`Edit .+/${slug}`) });
    await expect(drawer).toBeVisible();

    // 1. Unrelated edit of the expired link: allowed, expiry sent back unchanged.
    const moved = `${DEST}/moved`;
    await drawer.getByLabel("Destination URL").fill(moved);
    const patch1 = page.waitForResponse((r) => r.request().method() === "PATCH" && r.url().endsWith(`/links/${id}`));
    await drawer.getByRole("button", { name: "Save changes" }).click();
    expect((await patch1).status()).toBe(200);
    await expect(drawer).toBeHidden();
    const afterEdit = await api(session, "GET", `/links/${id}`);
    expect(afterEdit.body.destination).toBe(moved);
    expect(afterEdit.body.status).toBe("expired");
    expect(afterEdit.body.expiresAt).toBe(made.body.expiresAt);

    // 2. A different past day: refused inline, nothing sent.
    await page.getByRole("button", { name: "Edit", exact: true }).click();
    await drawer.getByRole("tab", { name: "Access", exact: true }).click();
    expect(await errorText(expiryInput(drawer))).toBeNull(); // its own expiry is not flagged
    let patched = 0;
    page.on("request", (r) => {
      if (r.method() === "PATCH" && r.url().endsWith(`/links/${id}`)) patched++;
    });
    await expiryInput(drawer).fill(dayIn(Date.now() - 2 * DAY));
    expect(await errorText(expiryInput(drawer))).toMatch(PAST);
    await drawer.getByRole("button", { name: "Save changes" }).click();
    await expect(drawer).toBeVisible();
    await page.waitForTimeout(500);
    expect(patched).toBe(0);
    await page.screenshot({ path: test.info().outputPath("edit-refused.png") });

    // 3. A future day: saved, and the short link works again.
    await expiryInput(drawer).fill(dayIn(Date.now() + 10 * DAY));
    expect(await errorText(expiryInput(drawer))).toBeNull();
    await drawer.getByRole("button", { name: "Save changes" }).click();
    await expect(drawer).toBeHidden();
    const revived = await api(session, "GET", `/links/${id}`);
    expect(revived.body.status).toBe("active");
    // The redirect service caches resolved links briefly; poll like j13 does.
    await expect.poll(async () => follow(slug), { message: "revived -> 302 to the new destination", timeout: 30_000 }).toEqual({ status: 302, location: moved });
  });

  test("the API refuses a past expiry itself, with the same words, on create, bulk and edit", async () => {
    const session = await registerUser(makeEmail("j754c"));
    const domain = await domainOf(session);
    const past = new Date(Date.now() - DAY).toISOString();

    const create = await api(session, "POST", "/links", { destination: DEST, domain, slug: slugFor("api"), expiresAt: past });
    expect(create.status).toBe(400);
    expect(JSON.stringify(create.body.message)).toMatch(PAST);

    const bulk = await api(session, "POST", "/links/bulk", { links: [{ destination: DEST, domain, slug: slugFor("b"), expiresAt: past }] });
    expect(bulk.status).toBe(200);
    const [row] = bulk.body.results as Array<{ ok: boolean; error?: string }>;
    expect(row!.ok).toBe(false);
    expect(row!.error).toMatch(PAST);

    const live = await api(session, "POST", "/links", { destination: DEST, domain, slug: slugFor("live") });
    const edit = await api(session, "PATCH", `/links/${live.body.id as string}`, { expiresAt: past });
    expect(edit.status).toBe(400);
    expect(JSON.stringify(edit.body.message)).toMatch(PAST);

    const garbage = await api(session, "POST", "/links", { destination: DEST, domain, slug: slugFor("g"), expiresAt: "not-a-date" });
    expect(garbage.status).toBe(400); // was a 500
    // Oracle: the API's zod pipe (apps/api/src/common/zod.pipe.ts:48) puts the
    // human messages in `message` (just the strings) and the field names in
    // `issues[].path` — the field name is NOT prefixed onto the message. This
    // is the contract apps/api/.../links.past-expiry.integration.test.ts:147-148
    // asserts: message=["Enter a valid date."], issues=[{path:"expiresAt",…}].
    expect(JSON.stringify(garbage.body.message)).toMatch(/Enter a valid date/);
    const issues = garbage.body.issues as Array<{ path?: string; message?: string }> | undefined;
    expect(issues?.some((i) => i.path === "expiresAt" && /Enter a valid date/.test(i.message ?? "")),
      "the invalid-date issue names the expiresAt field").toBe(true);
  });
});
