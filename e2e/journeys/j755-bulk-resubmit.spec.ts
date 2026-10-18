/**
 * Journey 755 — Bulk create: resubmitting after a partial failure (#755)
 *
 * After a partial result the whole textarea was sent again, and every row WITHOUT
 * a back-half was created a second time (the API can only recognise a repeated row by its
 * back-half; a slug-less row gets a new random one each request):
 *
 *   sign in -> Links -> Bulk create -> paste 5 lines (2 slug-less + 1 with a back-half
 *   succeed; 1 is not a URL; 1 asks for a back-half that already exists) -> Create
 *   -> only the 2 failed rows are left in the box -> Create again WITHOUT editing
 *   -> fix the rows, Create -> every destination exists exactly once.
 *
 * Oracles:
 *   - GET /links over HTTP (total and each item's destination): what the server really holds,
 *     counted before and after each click — independent of what the page says.
 *   - The real POST /links/bulk request bodies (waitForRequest / page.on("request")).
 *   - packages/contract/src/link.ts: BulkCreateLinksResult — one outcome per submitted row.
 *
 * Requires the local staging stack (api :3001, redirect :3002) built from this branch and the
 * web app on :3000 — see playwright.journeys.config.ts.
 */

import { expect, test, type Page } from "@playwright/test";
import { API_URL, RUN_PASSWORD, createLink, makeEmail, registerUser, type Session } from "./helpers";

const rand = () => Math.random().toString(36).slice(2, 8);

async function signIn(page: Page, session: Session) {
  await page.goto("/login");
  await page.getByPlaceholder("you@company.com").fill(session.email);
  await page.getByPlaceholder("••••••••").fill(RUN_PASSWORD);
  await page.getByRole("button", { name: "Sign in" }).click();
  await expect(page).not.toHaveURL(/\/login/, { timeout: 20_000 });
}

type Listed = { total: number; items: Array<{ destination: string; slug: string }> };

async function listLinks(session: Session): Promise<Listed> {
  const res = await fetch(`${API_URL}/links?limit=100`, { headers: { authorization: `Bearer ${session.accessToken}` } });
  expect(res.ok, "GET /links should succeed").toBe(true);
  return (await res.json()) as Listed;
}

const countOf = (l: Listed, destination: string) => l.items.filter((i) => i.destination === destination).length;

test.describe("Journey 755 — Bulk create resubmit after a partial failure", () => {
  test("a second Create never duplicates a row that was already created @mobile", async ({ page }) => {
    const session = await registerUser(makeEmail("j755"));
    const r = rand();
    const D = `https://example.com/j755-${r}`;
    const takenSlug = `j755-taken-${r}`;
    await createLink(session.accessToken, { destination: `${D}/existing`, slug: takenSlug });

    await signIn(page, session);
    await page.goto("/links");
    await page.getByRole("button", { name: "Bulk create" }).click();
    const box = page.getByLabel("One link per line");

    const sent: Array<{ links: Array<{ destination: string; slug?: string }> }> = [];
    page.on("request", (req) => {
      if (req.method() === "POST" && req.url().endsWith("/links/bulk")) sent.push(req.postDataJSON());
    });

    const spring = `${D}/spring`;
    const summer = `${D}/summer`;
    const fall = `${D}/fall`;
    const winter = `${D}/winter`;
    await box.fill([spring, `${summer}, j755-sum-${r}`, "not a url", fall, `${winter}, ${takenSlug}`].join("\n"));

    // Round 1: 3 created (two of them slug-less), 2 refused.
    const before = await listLinks(session);
    expect(before.total).toBe(1);
    await page.getByRole("button", { name: "Create 5 links" }).click();
    await expect(page.getByText("3 created.")).toBeVisible({ timeout: 20_000 });
    const afterFirst = await listLinks(session);
    expect(afterFirst.total).toBe(4);
    expect(countOf(afterFirst, spring)).toBe(1);
    expect(countOf(afterFirst, fall)).toBe(1);

    // Only the two failed rows remain, as typed, and the button says 2.
    await expect(box).toHaveValue(["not a url", `${winter}, ${takenSlug}`].join("\n"));
    await expect(page.getByRole("button", { name: "Create 2 links" })).toBeVisible();

    // Round 2, WITHOUT editing (the reported steps): nothing new may be created.
    await page.getByRole("button", { name: "Create 2 links" }).click();
    await expect(page.getByText("Nothing was created.")).toBeVisible({ timeout: 20_000 });
    expect(sent).toHaveLength(2);
    expect(sent[1]!.links.map((l) => l.destination)).toEqual(["not a url", winter]);
    const afterSecond = await listLinks(session);
    expect(afterSecond.total).toBe(4);
    expect(countOf(afterSecond, spring)).toBe(1);
    expect(countOf(afterSecond, fall)).toBe(1);
    expect(afterSecond.items.map((i) => i.slug).sort()).toEqual(afterFirst.items.map((i) => i.slug).sort());

    // Round 3: fix the two rows (an edit between submits) and send again.
    const fixed = `${D}/fixed`;
    await box.fill([fixed, `${winter}, j755-win-${r}`].join("\n"));
    await page.getByRole("button", { name: "Create 2 links" }).click();
    await expect(page.getByText("2 created.")).toBeVisible({ timeout: 20_000 });
    await expect(box).toHaveValue("");
    expect(sent).toHaveLength(3);
    expect(sent[2]!.links.map((l) => l.destination)).toEqual([fixed, winter]);

    const finalList = await listLinks(session);
    expect(finalList.total).toBe(6);
    for (const dest of [spring, summer, fall, fixed, winter]) {
      expect(countOf(finalList, dest), `${dest} exists exactly once`).toBe(1);
    }
  });
});
