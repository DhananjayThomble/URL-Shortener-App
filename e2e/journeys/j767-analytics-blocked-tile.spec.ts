/**
 * Journey — the Analytics "Blocked visits" tile counts every gate rejection (#767)
 *
 * The tile used to read "Blocked / unsafe" with the caption "Safe Browsing"
 * although it shows sum(click_daily.blocked): every visit the redirect rejected
 * and recorded (expired, scheduled, click limit, archived, flagged). A workspace
 * that never had anything flagged saw a non-zero "unsafe" count.
 *
 * A person (fresh workspace, so the totals are exact):
 *   1. has one expired link, one not-yet-live link and one normal link;
 *   2. visits each once, as a real browser (bots are excluded from rollups);
 *   3. waits for the rollup, then opens /analytics: Clicks = 1 (the normal
 *      visit), the tile reads "Blocked visits" = 2 and its caption names the
 *      reasons — no "Safe Browsing" claim anywhere on the page.
 *
 * Oracles: the issue's acceptance criteria; GET /analytics totals.blocked read
 * back through the API (the number must match what the tile shows). What the
 * PERSON reads. The click-limit reason is not driven here: it depends on the
 * rollup-lagged click count and the link cache TTL, so it cannot be made
 * deterministic in a short journey (the wording is covered by
 * web/src/lib/blocked-visits.test.ts).
 *
 * Requires the local staging stack + web on :3000. @mobile: also runs on the
 * mobile project.
 */

import { mkdirSync } from "node:fs";
import path from "node:path";
import { expect, test } from "@playwright/test";
import { API_URL, createLink, makeEmail, REDIRECT_URL, registerUser, seedAccount } from "./helpers";

const BROWSER_UA =
  "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36";
const CAPTION = "Expired, scheduled, over limit, archived or unsafe";
const EVIDENCE = process.env.QA_EVIDENCE_DIR ?? path.resolve(__dirname, "../../.qa-runs/767");

async function patchLink(token: string, id: string, body: Record<string, unknown>) {
  const res = await fetch(`${API_URL}/links/${id}`, {
    method: "PATCH",
    headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  expect(res.status, `PATCH /links/${id} ${await res.clone().text()}`).toBeLessThan(300);
}

async function visit(url: string): Promise<number> {
  const res = await fetch(url, { redirect: "manual", headers: { "user-agent": BROWSER_UA } });
  return res.status;
}

async function totals(token: string): Promise<{ clicks: number; blocked: number }> {
  const res = await fetch(`${API_URL}/analytics?range=24h`, { headers: { authorization: `Bearer ${token}` } });
  expect(res.status).toBe(200);
  const t = ((await res.json()) as { totals: { clicks: number; blocked: number } }).totals;
  return { clicks: t.clicks, blocked: t.blocked };
}

test.describe("Journey — analytics blocked visits tile (#767)", () => {
  test("@mobile the tile counts expired + scheduled rejections and says so", async ({ page }, testInfo) => {
    test.setTimeout(240_000);
    const session = await registerUser(makeEmail("j767"));
    const token = session.accessToken;

    // 1. Three links: normal, expired (API accepts a past expiresAt), not yet live.
    const ok = await createLink(token, { destination: "https://example.com/j767-ok" });
    const expired = await createLink(token, { destination: "https://example.com/j767-expired" });
    const scheduled = await createLink(token, { destination: "https://example.com/j767-scheduled" });
    await patchLink(token, expired.id, { expiresAt: new Date(Date.now() - 60_000).toISOString() });
    await patchLink(token, scheduled.id, { activatesAt: new Date(Date.now() + 7 * 86_400_000).toISOString() });

    // 2. One real-browser visit each; the gate answers 302 / 410 / 404.
    expect(await visit(`${REDIRECT_URL}/${ok.slug}`)).toBe(302);
    expect(await visit(`${REDIRECT_URL}/${expired.slug}`)).toBe(410);
    expect(await visit(`${REDIRECT_URL}/${scheduled.slug}`)).toBe(404);

    // 3. Wait for the rollup (1-minute job) to publish all three events.
    await expect
      .poll(async () => totals(token), { timeout: 150_000, intervals: [5_000] })
      .toEqual({ clicks: 1, blocked: 2 });

    await seedAccount(page, session);
    await page.goto("/analytics");

    const label = page.getByText("Blocked visits", { exact: true });
    await expect(label).toBeVisible({ timeout: 15_000 });
    const tile = label.locator("xpath=..");
    await expect(tile).toContainText("2");
    await expect(tile.getByText(CAPTION, { exact: true })).toBeVisible();
    await expect(page.getByText("Blocked / unsafe")).toHaveCount(0);
    await expect(page.getByText("Safe Browsing")).toHaveCount(0);

    mkdirSync(EVIDENCE, { recursive: true });
    await page.screenshot({ path: path.join(EVIDENCE, `${testInfo.project.name}-light.png`), fullPage: true });

    // Dark theme: same copy, still inside the tile.
    await page.evaluate(() => window.localStorage.setItem("snapurl.appearance", JSON.stringify({ mode: "dark" })));
    await page.reload();
    await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");
    await expect(page.getByText("Blocked visits", { exact: true })).toBeVisible({ timeout: 15_000 });
    await expect(page.getByText(CAPTION, { exact: true })).toBeVisible();
    await page.screenshot({ path: path.join(EVIDENCE, `${testInfo.project.name}-dark.png`), fullPage: true });

    // No horizontal overflow at this viewport (390px on the mobile project).
    expect(await page.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth)).toBe(false);
  });
});
