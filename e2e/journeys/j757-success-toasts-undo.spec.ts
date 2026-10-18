/**
 * Journey 757 — success feedback and an Undo on archive (#757)
 *
 * Creating, archiving, deleting and saving settings used to be silent, and
 * archive could not be taken back. A real user does this:
 *   sign in -> archive a link from the list -> see the confirmation -> press Undo
 *   -> the link is active again; then delete a link, create one from the detail
 *   page, and save a setting, each with a confirmation.
 *
 * Oracles (independent of the toast text): GET /links/:id over HTTP -- the
 * stored status after archive, after Undo, and the 404 after delete.
 *
 * Requires the local staging stack and the web app on :3000 -- see
 * playwright.journeys.config.ts.
 */

import path from "node:path";
import { expect, test, type Page } from "@playwright/test";
import { API_URL, RUN_PASSWORD, makeEmail, registerUser, type Session } from "./helpers";

const SHOTS = process.env.QA_757_SHOTS ?? path.resolve(__dirname, "../../.qa-runs/757");
const auth = (s: Session) => ({ authorization: `Bearer ${s.accessToken}`, "content-type": "application/json" });

async function signIn(page: Page, session: Session) {
  await page.goto("/login");
  await page.getByPlaceholder("you@company.com").fill(session.email);
  await page.getByPlaceholder("••••••••").fill(RUN_PASSWORD);
  await page.getByRole("button", { name: "Sign in" }).click();
  await expect(page).not.toHaveURL(/\/login/, { timeout: 20_000 });
}

async function createLink(session: Session, tag: string) {
  const ws = (await (await fetch(`${API_URL}/workspaces/current`, { headers: auth(session) })).json()) as { defaultDomain?: string };
  const slug = `j757-${tag}-${Date.now().toString(36)}`;
  const res = await fetch(`${API_URL}/links`, {
    method: "POST",
    headers: auth(session),
    body: JSON.stringify({ destination: `https://example.com/${slug}`, domain: ws.defaultDomain ?? "localhost:3002", slug }),
  });
  const text = await res.text();
  expect(res.ok, `POST /links → ${res.status} ${text.slice(0, 300)}`).toBe(true);
  return JSON.parse(text) as { id: string; slug: string; domain: string };
}

const getLink = (session: Session, id: string) => fetch(`${API_URL}/links/${id}`, { headers: auth(session) });
const statusOf = async (session: Session, id: string) => ((await (await getLink(session, id)).json()) as { status: string }).status;
const toast = (page: Page, text: RegExp | string) => page.getByTestId("toast").filter({ hasText: text });

test.describe("Journey 757 — success toasts and archive Undo", () => {
  test("archive confirms and Undo really unarchives; a double click archives one link @mobile", async ({ page }, info) => {
    const session = await registerUser(makeEmail("j757a"));
    const a = await createLink(session, "a");
    const b = await createLink(session, "b");
    await signIn(page, session);
    await page.goto("/links");

    const rowA = page.locator("article", { hasText: a.slug });
    await expect(rowA).toBeVisible({ timeout: 15_000 });

    await rowA.getByRole("button", { name: new RegExp(`^Archive link .+/${a.slug}$`) }).click();
    const t = toast(page, `Archived ${a.domain}/${a.slug}`);
    await expect(t).toBeVisible();
    await expect(page.locator("article", { hasText: a.slug })).toHaveCount(0);
    expect(await statusOf(session, a.id)).toBe("archived");
    await page.screenshot({ path: path.join(SHOTS, `${info.project.name}-1-archived-toast.png`) });

    await t.getByRole("button", { name: "Undo" }).click();
    await expect(toast(page, `Restored ${a.domain}/${a.slug}`)).toBeVisible();
    await expect(page.locator("article", { hasText: a.slug })).toBeVisible({ timeout: 15_000 });
    expect(await statusOf(session, a.id)).not.toBe("archived");
    await page.screenshot({ path: path.join(SHOTS, `${info.project.name}-2-restored-toast.png`) });

    /* Double click: only the link aimed at is archived. */
    const rowB = page.locator("article", { hasText: b.slug });
    await rowB.getByRole("button", { name: new RegExp(`^Archive link .+/${b.slug}$`) }).dblclick();
    await expect(page.locator("article", { hasText: b.slug })).toHaveCount(0, { timeout: 15_000 });
    await page.waitForTimeout(800);
    expect(await statusOf(session, b.id)).toBe("archived");
    expect(await statusOf(session, a.id)).not.toBe("archived");
  });

  test("delete, create and settings save each confirm @mobile", async ({ page }, info) => {
    const session = await registerUser(makeEmail("j757b"));
    const doomed = await createLink(session, "del");
    await signIn(page, session);

    /* Delete from the detail page. */
    await page.goto(`/links/${doomed.id}`);
    await page.getByRole("button", { name: "Delete this link" }).click();
    await page.getByRole("button", { name: "Delete for good" }).click();
    await expect(page).toHaveURL(/\/links$/, { timeout: 15_000 });
    await expect(toast(page, `Deleted ${doomed.domain}/${doomed.slug}`)).toBeVisible();
    expect((await getLink(session, doomed.id)).status).toBe(404);
    await page.screenshot({ path: path.join(SHOTS, `${info.project.name}-3-deleted-toast.png`) });

    /* Create from the New link drawer, opened on a link-detail page. */
    const keep = await createLink(session, "keep");
    await page.goto(`/links/${keep.id}`);
    await page.getByRole("button", { name: /New link|Create a link/ }).first().click();
    const drawer = page.getByRole("dialog", { name: "Create a link" });
    const slug = `j757-new-${Date.now().toString(36)}`;
    await drawer.getByLabel("Destination URL").fill("https://example.com/j757-new");
    await drawer.getByLabel("Short link").fill(slug);
    await drawer.getByRole("button", { name: "Create link" }).click();
    await expect(drawer).toBeHidden({ timeout: 15_000 });
    await expect(toast(page, new RegExp(`^Created .+/${slug}`))).toBeVisible();
    await page.screenshot({ path: path.join(SHOTS, `${info.project.name}-4-created-toast.png`) });

    /* Settings. */
    await page.goto("/settings");
    await page.getByRole("group", { name: "Default redirect type" }).getByRole("button", { name: "307", exact: true }).click();
    await page.getByRole("button", { name: "Save changes" }).click();
    await expect(toast(page, "Settings saved")).toBeVisible();
    const ws = (await (await fetch(`${API_URL}/workspaces/current`, { headers: auth(session) })).json()) as { defaultRedirect: string };
    expect(ws.defaultRedirect).toBe("307");
    await page.screenshot({ path: path.join(SHOTS, `${info.project.name}-5-settings-toast.png`) });
  });
});
