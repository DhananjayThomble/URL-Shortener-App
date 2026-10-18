/**
 * Journey 760 — an archived scheduled link keeps its schedule in the row (#760)
 *
 * The Archived filter showed "Never expires" for a link that was set to go live
 * on a future date, because the row described a link by its `status` and an
 * archived link's status is just "archived". The API still returns the schedule
 * (it reappears on unarchive), so only the label was wrong.
 *
 * A real user does this:
 *   schedule a link -> archive it from the list -> open the Archived filter ->
 *   expand the row and read the details line.
 *
 * Oracles:
 *   - GET /links/:id over HTTP: status "archived" and the stored `activatesAt`
 *     (independent read of what the row has to describe).
 *   - The same row before archiving ("All" list) — archiving must not change the
 *     schedule it prints.
 *
 * Requires the local staging stack and the web app on :3000 — see
 * playwright.journeys.config.ts.
 */

import path from "node:path";
import { expect, test, type Locator, type Page } from "@playwright/test";
import { API_URL, RUN_PASSWORD, makeEmail, registerUser, type Session } from "./helpers";

const DEST = "https://example.com/j760-destination";
const SHOTS = process.env.QA_760_SHOTS ?? path.resolve(__dirname, "../../.qa-runs/760");

async function signIn(page: Page, session: Session) {
  await page.goto("/login");
  await page.getByPlaceholder("you@company.com").fill(session.email);
  await page.getByPlaceholder("••••••••").fill(RUN_PASSWORD);
  await page.getByRole("button", { name: "Sign in" }).click();
  await expect(page).not.toHaveURL(/\/login/, { timeout: 20_000 });
}

async function createScheduled(session: Session, activatesAt: string) {
  const ws = (await (await fetch(`${API_URL}/workspaces/current`, {
    headers: { authorization: `Bearer ${session.accessToken}` },
  })).json()) as { defaultDomain?: string };
  const slug = `j760-${Date.now().toString(36)}`;
  const res = await fetch(`${API_URL}/links`, {
    method: "POST",
    headers: { authorization: `Bearer ${session.accessToken}`, "content-type": "application/json" },
    body: JSON.stringify({ destination: DEST, domain: ws.defaultDomain ?? "localhost:3002", slug, activatesAt }),
  });
  const text = await res.text();
  expect(res.ok, `POST /links → ${res.status} ${text.slice(0, 300)}`).toBe(true);
  return JSON.parse(text) as { id: string; slug: string; status: string; activatesAt: string | null };
}

/** The first row of a list opens by default; any other starts collapsed. */
async function expandRow(row: Locator) {
  const show = row.getByRole("button", { name: "Show routing" });
  if (await show.count()) await show.click();
  await expect(row.getByRole("button", { name: "Hide routing" })).toBeVisible();
}

async function getLink(session: Session, id: string) {
  const res = await fetch(`${API_URL}/links/${id}`, { headers: { authorization: `Bearer ${session.accessToken}` } });
  expect(res.ok).toBe(true);
  return (await res.json()) as { status: string; activatesAt: string | null };
}

test.describe("Journey 760 — archived scheduled link", () => {
  test("the Archived filter row still says when the link goes live @mobile", async ({ page }, info) => {
    const session = await registerUser(makeEmail("j760"));
    const activatesAt = new Date(Date.now() + 9 * 864e5).toISOString();
    const link = await createScheduled(session, activatesAt);
    expect(link.status).toBe("scheduled");
    await signIn(page, session);

    /* Normal list: the scheduled row prints its start date. */
    await page.goto("/links");
    const row = page.locator("article", { hasText: link.slug });
    await expect(row).toBeVisible({ timeout: 15_000 });
    await expandRow(row);
    const before = await row.getByText(/Goes live|Never expires|Expires/).first().innerText();
    expect(before).toMatch(/Goes live/);
    await page.screenshot({ path: path.join(SHOTS, `${info.project.name}-1-all-scheduled.png`) });

    /* Archive it from the row. */
    await row.getByRole("button", { name: new RegExp(`Archive link .+/${link.slug}`) }).click();
    await expect(page.locator("article", { hasText: link.slug })).toHaveCount(0, { timeout: 15_000 });
    const stored = await getLink(session, link.id);
    expect(stored.status).toBe("archived");
    expect(stored.activatesAt, "the API keeps the schedule on an archived link").not.toBeNull();

    /* Archived filter: same schedule, never the "Never expires" lie. */
    await page.getByRole("button", { name: "Archived" }).click();
    const archived = page.locator("article", { hasText: link.slug });
    await expect(archived).toBeVisible({ timeout: 15_000 });
    await expect(archived.getByText("Archived", { exact: true })).toBeVisible();
    await expandRow(archived);
    await expect(archived.getByText("Never expires")).toHaveCount(0);
    await expect(archived.getByText(/Goes live/)).toBeVisible();
    await page.screenshot({ path: path.join(SHOTS, `${info.project.name}-2-archived-scheduled.png`) });

    /* Unarchive: the same text comes back, so nothing was lost either way. */
    await archived.getByRole("button", { name: new RegExp(`Unarchive link .+/${link.slug}`) }).click();
    await expect(page.locator("article", { hasText: link.slug })).toHaveCount(0, { timeout: 15_000 });
    await page.getByRole("button", { name: "All" }).click();
    const back = page.locator("article", { hasText: link.slug });
    await expect(back).toBeVisible({ timeout: 15_000 });
    await expandRow(back);
    await expect(back.getByText(/Goes live/)).toBeVisible();
  });
});
