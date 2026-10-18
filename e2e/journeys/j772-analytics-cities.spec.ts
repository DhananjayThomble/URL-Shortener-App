/**
 * Journey — the Analytics "Cities" card is fed by real redirects (#772)
 *
 * QA saw the demo workspace's Cities card read "Nothing here yet" beside
 * 131,866 clicks while Countries was full. The cause was the demo seed, which
 * never wrote city rollups (packages/database/scripts/seed-breakdowns.ts now
 * does). This journey guards the half that was NOT broken and must stay that
 * way: a visit carrying CloudFront's city header lands on the Cities card,
 * with the k-anonymity floor applied (CITY_MIN_CLICKS = 5 in
 * apps/api/src/analytics/analytics.service.ts).
 *
 * A person (fresh workspace, so the numbers are exact):
 *   1. has one link and gets 6 visits from Pune, 2 from Nagpur and 1 that
 *      CloudFront could not place, all as a real browser (bots are excluded);
 *   2. waits for the rollup, then opens /analytics: the Cities card names
 *      Pune (6), never names Nagpur (2 is under the floor) and shows it as
 *      "Other cities" (2), and shows "Unknown" (1).
 *
 * Locally there is no CloudFront, so the CloudFront-Viewer-* headers are sent
 * by hand, exactly as scripts/smoke-redirect.sh does for country and city.
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
const EVIDENCE = process.env.QA_EVIDENCE_DIR ?? path.resolve(__dirname, "../../.qa-runs/772");

type Row = { label: string; value: number };

async function visit(url: string, country: string, city?: string): Promise<number> {
  const headers: Record<string, string> = { "user-agent": BROWSER_UA, "cloudfront-viewer-country": country };
  if (city) headers["cloudfront-viewer-city"] = city;
  const res = await fetch(url, { redirect: "manual", headers });
  return res.status;
}

async function cities(token: string): Promise<Row[]> {
  const res = await fetch(`${API_URL}/analytics?range=24h`, { headers: { authorization: `Bearer ${token}` } });
  expect(res.status).toBe(200);
  return ((await res.json()) as { cities: Row[] }).cities;
}

test.describe("Journey — analytics Cities card (#772)", () => {
  test("@mobile a city header becomes a named city, small cities fold into Other cities", async ({ page }, testInfo) => {
    test.setTimeout(240_000);
    const session = await registerUser(makeEmail("j772"));
    const token = session.accessToken;
    const link = await createLink(token, { destination: "https://example.com/j772" });
    const url = `${REDIRECT_URL}/${link.slug}`;

    for (let i = 0; i < 6; i++) expect(await visit(url, "IN", "Pune")).toBe(302);
    for (let i = 0; i < 2; i++) expect(await visit(url, "IN", "Nagpur")).toBe(302);
    expect(await visit(url, "US")).toBe(302);

    // The API is the oracle the card must match.
    const expected = [
      { label: "Pune", value: 6 },
      { label: "Unknown", value: 1 },
      { label: "Other cities", value: 2 },
    ];
    await expect.poll(async () => cities(token), { timeout: 150_000, intervals: [5_000] }).toEqual(expected);

    await seedAccount(page, session);
    await page.goto("/analytics");

    const card = page.locator("div", { has: page.getByText("Cities", { exact: true }) }).filter({
      has: page.getByText("Other cities"),
    }).last();
    await expect(card.getByText("Pune", { exact: true })).toBeVisible({ timeout: 15_000 });
    await expect(card.getByText("Unknown", { exact: true })).toBeVisible();
    await expect(card.getByText("Other cities", { exact: true })).toBeVisible();
    await expect(card.getByText("Nothing here yet")).toHaveCount(0);
    // A city under the floor is never named anywhere on the page.
    await expect(page.getByText("Nagpur")).toHaveCount(0);

    mkdirSync(EVIDENCE, { recursive: true });
    await card.scrollIntoViewIfNeeded();
    await page.screenshot({ path: path.join(EVIDENCE, `j772-${testInfo.project.name}-light.png`) });

    await page.evaluate(() => window.localStorage.setItem("snapurl.appearance", JSON.stringify({ mode: "dark" })));
    await page.reload();
    await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");
    await expect(page.getByText("Pune", { exact: true })).toBeVisible({ timeout: 15_000 });
    await page.getByText("Pune", { exact: true }).scrollIntoViewIfNeeded();
    await page.screenshot({ path: path.join(EVIDENCE, `j772-${testInfo.project.name}-dark.png`) });

    expect(await page.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth)).toBe(false);
  });
});
