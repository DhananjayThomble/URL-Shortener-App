/**
 * Journey 758 — Typing a click limit into the link drawers (#758)
 *
 * The Click limit field clamped on every keystroke: a cleared box snapped back to 1
 * ("-5" typed as "15") and 0 or a negative number was saved as 1 with no message.
 * `fill()` never shows it (one input event), so this journey types key by key:
 *
 *   sign in -> Edit -> Access -> limit on -> type 0 / -5 / "" / 2.5 / 1e3 -> refused with a
 *   message, nothing saved -> type 25 -> Save -> (API read) -> reload -> Edit shows 25
 *   New link -> Access -> limit on -> type 0 -> refused -> type 7 -> Create -> (API read)
 *
 * and the API itself refuses the same values (it used to accept 0, -5, 2.5 and a number
 * past the Postgres integer, which was a 500 or a link that expired before its first click).
 *
 * Oracles:
 *   - The real POST /links and PATCH /links/:id bodies (waitForRequest).
 *   - GET /links/:id over HTTP (what was persisted, independent of the UI).
 *   - packages/contract/src/link.ts: ClickLimitInput — whole number 1..2,147,483,647; null = no limit.
 *
 * Requires the local staging stack (api :3001, redirect :3002) built from this branch and the
 * web app on :3000 — see playwright.journeys.config.ts.
 */

import { expect, test, type Locator, type Page } from "@playwright/test";
import { API_URL, RUN_PASSWORD, createLink, makeEmail, registerUser, type Session } from "./helpers";

const DEST = "https://example.com/j758-destination";

const slugFor = (tag: string) => `j758-${tag}-${Math.random().toString(36).slice(2, 8)}`;

/** Real sign-in through the login form, as a user would. */
async function signIn(page: Page, session: Session) {
  await page.goto("/login");
  await page.getByPlaceholder("you@company.com").fill(session.email);
  await page.getByPlaceholder("••••••••").fill(RUN_PASSWORD);
  await page.getByRole("button", { name: "Sign in" }).click();
  await expect(page).not.toHaveURL(/\/login/, { timeout: 20_000 });
}

const limitInput = (drawer: Locator) => drawer.getByLabel("Click limit", { exact: true });
const limitToggle = (drawer: Locator) => drawer.getByRole("button", { name: /Expire after a click limit/ });

async function retype(input: Locator, text: string) {
  await input.click();
  await input.press("ControlOrMeta+a");
  if (text === "") await input.press("Backspace");
  else await input.pressSequentially(text);
}

async function errorText(input: Locator): Promise<string | null> {
  const id = await input.getAttribute("aria-describedby");
  return id ? input.page().locator(`[id="${id}"]`).textContent() : null;
}

const auth = (s: Session) => ({ authorization: `Bearer ${s.accessToken}`, "content-type": "application/json" });

async function getLink(session: Session, id: string) {
  const res = await fetch(`${API_URL}/links/${id}`, { headers: auth(session) });
  expect(res.ok, "GET /links/:id should succeed").toBe(true);
  return (await res.json()) as { clickLimit: number | null };
}

async function patchLink(session: Session, id: string, body: object) {
  const res = await fetch(`${API_URL}/links/${id}`, { method: "PATCH", headers: auth(session), body: JSON.stringify(body) });
  return { status: res.status, body: (await res.json().catch(() => ({}))) as { message?: unknown } };
}

test.describe("Journey 758 — Typing a click limit into the link drawers", () => {
  test("edit: bad entries are kept, explained and never saved; '25' typed after clearing saves 25 @mobile", async ({ page }) => {
    const session = await registerUser(makeEmail("j758a"));
    const link = await createLink(session.accessToken, { destination: DEST });
    await signIn(page, session);

    await page.goto(`/links/${link.id}`);
    await page.getByRole("button", { name: "Edit", exact: true }).click();
    const drawer = page.getByRole("dialog", { name: new RegExp(`Edit .+/${link.slug}`) });
    await expect(drawer).toBeVisible();
    await drawer.getByRole("tab", { name: "Access", exact: true }).click();
    const input = limitInput(drawer);
    await expect(input).toBeDisabled(); // no limit yet
    await limitToggle(drawer).click();
    await expect(input).toHaveValue("500");

    // Every refused entry: kept exactly as typed, a readable message, and no PATCH is ever sent.
    let patched = 0;
    page.on("request", (r) => {
      if (r.method() === "PATCH" && r.url().endsWith(`/links/${link.id}`)) patched++;
    });
    for (const [text, wording] of [
      ["0", "at least 1"],
      ["-5", "at least 1"],
      ["", "Enter a click limit"],
      ["2.5", "whole number"],
      ["1e3", "whole number"],
      ["2147483648", "more than"],
    ] as const) {
      await retype(input, text);
      await expect(input).toHaveValue(text); // not rewritten to 1 / 15
      await drawer.getByRole("button", { name: "Save changes" }).click();
      await expect(drawer).toBeVisible();
      expect(await errorText(input), `message for ${JSON.stringify(text)}`).toContain(wording);
    }
    expect(patched).toBe(0);
    expect((await getLink(session, link.id)).clickLimit).toBeNull();

    // Emptied, then retyped: 25 - not 125.
    await retype(input, "");
    await input.pressSequentially("25");
    await expect(input).toHaveValue("25");
    expect(await errorText(input)).toBeNull();
    const patch = page.waitForRequest((r) => r.method() === "PATCH" && r.url().endsWith(`/links/${link.id}`));
    await drawer.getByRole("button", { name: "Save changes" }).click();
    expect(((await patch).postDataJSON() as { clickLimit: number }).clickLimit).toBe(25);
    await expect(drawer).toBeHidden({ timeout: 15_000 });
    expect((await getLink(session, link.id)).clickLimit).toBe(25);

    // Reload: the value comes from GET /links/:id.
    await page.reload();
    await page.getByRole("button", { name: "Edit", exact: true }).click();
    const reopened = page.getByRole("dialog", { name: new RegExp(`Edit .+/${link.slug}`) });
    await reopened.getByRole("tab", { name: "Access", exact: true }).click();
    await expect(limitInput(reopened)).toHaveValue("25");

    // Turning the limit off removes it.
    await limitToggle(reopened).click();
    await reopened.getByRole("button", { name: "Save changes" }).click();
    await expect(reopened).toBeHidden({ timeout: 15_000 });
    expect((await getLink(session, link.id)).clickLimit).toBeNull();
  });

  test("create: '0' is refused with a message, '7' creates a link limited to 7 @mobile", async ({ page }) => {
    const session = await registerUser(makeEmail("j758b"));
    const slug = slugFor("create");
    await signIn(page, session);

    await page.goto("/links");
    await page.getByRole("button", { name: /New link|Create a link/ }).first().click();
    const drawer = page.getByRole("dialog", { name: "Create a link" });
    await expect(drawer).toBeVisible();
    await drawer.getByLabel("Destination URL").fill(DEST);
    await expect(drawer.getByLabel("Short-link domain")).not.toHaveValue("");
    await drawer.getByLabel("Short link").fill(slug);
    await drawer.getByRole("tab", { name: "Access", exact: true }).click();
    await limitToggle(drawer).click();

    const input = limitInput(drawer);
    await retype(input, "0");
    await expect(input).toHaveValue("0");
    await drawer.getByRole("button", { name: "Create link" }).click();
    await expect(drawer).toBeVisible();
    expect(await errorText(input)).toContain("at least 1");
    const none = await fetch(`${API_URL}/links?search=${slug}`, { headers: auth(session) });
    expect(((await none.json()) as { items: unknown[] }).items).toHaveLength(0);

    await retype(input, "7");
    const post = page.waitForRequest((r) => r.method() === "POST" && r.url().endsWith("/links"));
    await drawer.getByRole("button", { name: "Create link" }).click();
    expect(((await post).postDataJSON() as { clickLimit: number }).clickLimit).toBe(7);
    await expect(drawer).toBeHidden({ timeout: 15_000 });

    const listed = await fetch(`${API_URL}/links?search=${slug}`, { headers: auth(session) });
    const stored = ((await listed.json()) as { items: { slug: string; clickLimit: number | null }[] }).items.find((l) => l.slug === slug);
    expect(stored?.clickLimit).toBe(7);
  });

  test("API: refuses a click limit that is not a whole number from 1 to 2147483647, accepts the bounds and null", async () => {
    const session = await registerUser(makeEmail("j758c"));
    const link = await createLink(session.accessToken, { destination: DEST });

    for (const bad of [0, -1, -5, 2.5, 2147483648, 3_000_000_000, "5", ""]) {
      const r = await patchLink(session, link.id, { clickLimit: bad });
      expect(r.status, `PATCH clickLimit=${JSON.stringify(bad)}`).toBe(400);
      expect(JSON.stringify(r.body.message)).toMatch(/Click limit/);
      expect(JSON.stringify(r.body.message)).not.toMatch(/Invalid input|Expected/);
    }
    expect((await getLink(session, link.id)).clickLimit).toBeNull(); // nothing was saved

    // POST /links is bound by the same contract.
    const ws = (await (await fetch(`${API_URL}/workspaces/current`, { headers: auth(session) })).json()) as { defaultDomain: string };
    const post = await fetch(`${API_URL}/links`, {
      method: "POST",
      headers: auth(session),
      body: JSON.stringify({ destination: DEST, domain: ws.defaultDomain, slug: slugFor("api"), clickLimit: 0 }),
    });
    expect(post.status).toBe(400);

    for (const ok of [1, 2147483647]) {
      expect((await patchLink(session, link.id, { clickLimit: ok })).status).toBe(200);
      expect((await getLink(session, link.id)).clickLimit).toBe(ok);
    }
    expect((await patchLink(session, link.id, { clickLimit: null })).status).toBe(200);
    expect((await getLink(session, link.id)).clickLimit).toBeNull();
  });
});
