/**
 * Journey 752 — Typing tags into the link drawers (#752)
 *
 * The Tags field was controlled from the parsed array, so a typed comma (and the
 * space after it) was filtered out on the very keystroke that produced it:
 * "qa-tag1, qa-tag2" was saved as ONE tag "qa-tag1qa-tag2". `fill()` never showed
 * it (one input event with the whole text), so this journey types key by key:
 *
 *   sign in -> New link -> type tags -> Create -> (API read) -> open Edit ->
 *   type more tags -> Save -> (API read) -> reload -> Edit shows them.
 *
 * Oracles:
 *   - The real POST /links and PATCH /links/:id bodies (waitForRequest).
 *   - GET /links/:id over HTTP (what was persisted, independent of the UI).
 *   - GET /links?tag=<t> — the filter is an exact match, so each tag must be
 *     findable on its own (the "ab" bug made `qa-tag1` match nothing).
 *   - packages/contract/src/link.ts: `tags: string[]`.
 *
 * Requires the local staging stack (api :3001, redirect :3002) and the web app
 * on :3000 — see playwright.journeys.config.ts.
 */

import { expect, test, type Locator, type Page } from "@playwright/test";
import { API_URL, RUN_PASSWORD, createLink, makeEmail, registerUser, type Session } from "./helpers";

const DEST = "https://example.com/j752-destination";

const slugFor = (tag: string) => `j752-${tag}-${Math.random().toString(36).slice(2, 8)}`;

/** Real sign-in through the login form, as a user would. */
async function signIn(page: Page, session: Session) {
  await page.goto("/login");
  await page.getByPlaceholder("you@company.com").fill(session.email);
  await page.getByPlaceholder("••••••••").fill(RUN_PASSWORD);
  await page.getByRole("button", { name: "Sign in" }).click();
  await expect(page).not.toHaveURL(/\/login/, { timeout: 20_000 });
}

const tagsInput = (drawer: Locator) => drawer.getByLabel("Tags", { exact: true });

async function getLink(session: Session, id: string) {
  const res = await fetch(`${API_URL}/links/${id}`, { headers: { authorization: `Bearer ${session.accessToken}` } });
  expect(res.ok, "GET /links/:id should succeed").toBe(true);
  return (await res.json()) as { tags: string[] };
}

/** Slugs of the links the API returns for an exact tag filter. */
async function slugsWithTag(session: Session, tag: string): Promise<string[]> {
  const res = await fetch(`${API_URL}/links?tag=${encodeURIComponent(tag)}`, {
    headers: { authorization: `Bearer ${session.accessToken}` },
  });
  expect(res.ok, "GET /links?tag= should succeed").toBe(true);
  return ((await res.json()) as { items: { slug: string }[] }).items.map((l) => l.slug);
}

test.describe("Journey 752 — Typing tags into the link drawers", () => {
  test("create: 'a, b' typed key by key is saved as two tags, each findable by the tag filter @mobile", async ({ page }) => {
    const session = await registerUser(makeEmail("j752a"));
    const slug = slugFor("create");
    await signIn(page, session);

    await page.goto("/links");
    await page.getByRole("button", { name: /New link/ }).first().click();
    const drawer = page.getByRole("dialog", { name: "Create a link" });
    await expect(drawer).toBeVisible();
    await drawer.getByLabel("Destination URL").fill(DEST);
    await expect(drawer.getByLabel("Short-link domain")).not.toHaveValue("");
    await drawer.getByLabel("Short link").fill(slug);

    const tags = tagsInput(drawer);
    await tags.click();
    await tags.pressSequentially("qa-tag1,");
    await expect(tags).toHaveValue("qa-tag1,");
    await tags.pressSequentially(" qa-tag2, spring sale");
    await expect(tags).toHaveValue("qa-tag1, qa-tag2, spring sale");

    const post = page.waitForRequest((r) => r.method() === "POST" && r.url().endsWith("/links"));
    await drawer.getByRole("button", { name: "Create link" }).click();
    expect(((await post).postDataJSON() as { tags: string[] }).tags).toEqual(["qa-tag1", "qa-tag2", "spring sale"]);
    await expect(drawer).toBeHidden({ timeout: 15_000 });

    // Persisted, found by id and by each tag on its own.
    const row = page.getByRole("button", { name: new RegExp(`Copy short link .+/${slug}$`) });
    await expect(row).toBeVisible();
    const listed = await fetch(`${API_URL}/links?search=${slug}`, { headers: { authorization: `Bearer ${session.accessToken}` } });
    const stored = ((await listed.json()) as { items: { id: string; slug: string; tags: string[] }[] }).items.find((l) => l.slug === slug);
    expect(stored?.tags).toEqual(["qa-tag1", "qa-tag2", "spring sale"]);
    for (const t of ["qa-tag1", "qa-tag2", "spring sale"]) expect(await slugsWithTag(session, t)).toContain(slug);
    expect(await slugsWithTag(session, "qa-tag1qa-tag2")).toEqual([]);
  });

  test("edit: extend the tags by typing, save, reload, and see them again @mobile", async ({ page }) => {
    const session = await registerUser(makeEmail("j752b"));
    const link = await createLink(session.accessToken, { destination: DEST });
    // Seed the starting tags through the API (a real PATCH), as an earlier edit would have.
    const seed = await fetch(`${API_URL}/links/${link.id}`, {
      method: "PATCH",
      headers: { authorization: `Bearer ${session.accessToken}`, "content-type": "application/json" },
      body: JSON.stringify({ tags: ["alpha", "beta"] }),
    });
    expect(seed.ok).toBe(true);
    await signIn(page, session);

    await page.goto(`/links/${link.id}`);
    await page.getByRole("button", { name: "Edit", exact: true }).click();
    const drawer = page.getByRole("dialog", { name: new RegExp(`Edit .+/${link.slug}`) });
    await expect(drawer).toBeVisible();

    const tags = tagsInput(drawer);
    await expect(tags).toHaveValue("alpha, beta");
    await tags.click();
    await tags.press("End");
    await tags.pressSequentially(", gamma delta");
    await expect(tags).toHaveValue("alpha, beta, gamma delta");

    const patch = page.waitForRequest((r) => r.method() === "PATCH" && r.url().endsWith(`/links/${link.id}`));
    await drawer.getByRole("button", { name: "Save changes" }).click();
    expect(((await patch).postDataJSON() as { tags: string[] }).tags).toEqual(["alpha", "beta", "gamma delta"]);
    await expect(drawer).toBeHidden({ timeout: 15_000 });
    expect((await getLink(session, link.id)).tags).toEqual(["alpha", "beta", "gamma delta"]);

    // Reload: the values come from GET /links/:id, not from local state.
    await page.reload();
    await page.getByRole("button", { name: "Edit", exact: true }).click();
    const reopened = page.getByRole("dialog", { name: new RegExp(`Edit .+/${link.slug}`) });
    await expect(tagsInput(reopened)).toHaveValue("alpha, beta, gamma delta");

    // And removing every tag by emptying the field clears them on the server.
    await tagsInput(reopened).fill("");
    await reopened.getByRole("button", { name: "Save changes" }).click();
    await expect(reopened).toBeHidden({ timeout: 15_000 });
    expect((await getLink(session, link.id)).tags).toEqual([]);
  });
});
