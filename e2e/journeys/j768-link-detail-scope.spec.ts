/**
 * Journey 768 — link detail: one consistent scope  @mobile
 *
 * The link detail page used to headline the link's ALL-TIME click counter next
 * to a delta and breakdowns for the SELECTED range (#768). Against the real
 * stack: seed history on three dates, drive real clicks through the redirect
 * with a browser User-Agent (bots are excluded from rollups), wait for the
 * rollup, then check every range tab.
 *
 * Oracle (written by hand from what we seeded, not read from the implementation):
 *   today        5 clicks driven through the redirect
 *   10 days ago  20 clicks / 15 uniques   (seeded)
 *   45 days ago  100 clicks / 80 uniques  (seeded)
 *   400 days ago 1000 clicks / 900 uniques (seeded)
 *   => 24h = 5 · 30d = 25 · 12m = 125 · all-time (link_counters, summed from
 *      click_daily by the rollup) = 1,125.
 * The breakdown beneath each total must add up to that total, and the tile must
 * equal GET /analytics?range=…&linkId=… (what /analytics shows for that link).
 *
 * Set QA_EVIDENCE_DIR to also write screenshots there.
 */

import { execFileSync } from "node:child_process";
import path from "node:path";
import { expect, test, type Locator, type Page } from "@playwright/test";
import { API_URL, REDIRECT_URL, createLink, makeEmail, registerUser, seedAccount, type Session } from "./helpers";

// Run SQL inside the staging Postgres container with `docker exec`, the pattern
// j15/j16/j23 already use (SQL on stdin). CI has no host `psql` binary; the
// docker CLI is always present on a GitHub runner. The container name comes
// from the compose project name `snapurl-staging`, overridable with
// DB_CONTAINER (docker-compose.staging.yml; spec design §1 "Facts").
const DB_CONTAINER = process.env.DB_CONTAINER ?? "snapurl-staging-postgres";
const CHROME_UA =
  "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36";
const EVIDENCE = process.env.QA_EVIDENCE_DIR;

const TODAY_CLICKS = 5;
const SEED = [
  { ago: 10, clicks: 20, uniques: 15, country: "IN" },
  { ago: 45, clicks: 100, uniques: 80, country: "US" },
  { ago: 400, clicks: 1000, uniques: 900, country: "GB" },
];
const EXPECTED = { "24h": 5, "30d": 25, "12m": 125 } as const;
/* Delta vs the immediately-preceding window of the same length, by hand:
   30d: (25 − 100) / 100 = −75%  (the 45-day-old row is in days 59..30 back)
   12m: (125 − 1000) / 1000 = −87.5% (the 400-day-old row is in days 729..365 back)
   24h: yesterday had nothing, so there is no comparison. */
const DELTA = { "24h": "—", "30d": "▼ 75.0% vs prev 30d", "12m": "▼ 87.5% vs prev 12m" } as const;
const ALL_TIME = 5 + 20 + 100 + 1000;

const psql = (sql: string) =>
  execFileSync(
    "docker",
    ["exec", "-i", DB_CONTAINER, "psql", "-U", "snapurl", "-d", "snapurl", "-v", "ON_ERROR_STOP=1"],
    { input: sql, stdio: ["pipe", "pipe", "pipe"] },
  );

async function getJson<T>(session: Session, p: string): Promise<T> {
  const res = await fetch(`${API_URL}${p}`, { headers: { authorization: `Bearer ${session.accessToken}` } });
  if (!res.ok) throw new Error(`GET ${p} → ${res.status}`);
  return (await res.json()) as T;
}

type AnalyticsRes = { totals: { clicks: number; unique: number }; countries: { value: number }[] };

async function waitFor(what: string, probe: () => Promise<boolean>, tries = 30, delayMs = 5000) {
  for (let i = 0; i < tries; i++) {
    if (await probe()) return;
    await new Promise((r) => setTimeout(r, delayMs));
  }
  throw new Error(`timed out waiting for ${what}`);
}

const tile = (page: Page, label: string): Locator =>
  page.locator("main").getByText(label, { exact: true }).locator("xpath=ancestor::div[contains(@class,'bg-surface')][1]");
const card = (page: Page, title: string): Locator =>
  page.getByRole("heading", { name: title, exact: true }).locator("xpath=ancestor::div[contains(@class,'bg-surface')][1]");
const num = (s: string) => Number(s.replace(/,/g, ""));

async function seedLink(intent: string): Promise<{ session: Session; linkId: string }> {
  const session = await registerUser(makeEmail(`j768-${intent}-${test.info().project.name}`));
  const link = await createLink(session.accessToken, { destination: "https://example.com/j768-target" });

  // Seeded history FIRST, so the rollup's link_counters recompute (a sum over
  // click_daily) includes it — that is what makes the all-time counter 1,125.
  for (const s of SEED) {
    psql(
      `insert into click_daily (link_id, workspace_id, day, clicks, uniques) values ('${link.id}', '${session.workspaceId}', current_date - ${s.ago}, ${s.clicks}, ${s.uniques});` +
        `insert into breakdown_daily (workspace_id, link_id, day, dimension, value, count) values ('${session.workspaceId}', '${link.id}', current_date - ${s.ago}, 'country', '${s.country}', ${s.clicks});`,
    );
  }

  for (let i = 0; i < TODAY_CLICKS; i++) {
    const res = await fetch(`${REDIRECT_URL}/${link.slug}`, { redirect: "manual", headers: { "user-agent": CHROME_UA } });
    expect(res.status, "redirect answers 3xx").toBeGreaterThanOrEqual(300);
    expect(res.status).toBeLessThan(400);
  }

  await waitFor("the rollup to count today's clicks", async () => {
    const a = await getJson<AnalyticsRes>(session, `/analytics?range=24h&linkId=${link.id}`);
    const l = await getJson<{ clicks: number }>(session, `/links/${link.id}`);
    return a.totals.clicks === TODAY_CLICKS && l.clicks === ALL_TIME;
  });
  return { session, linkId: link.id };
}

async function checkRange(page: Page, session: Session, linkId: string, range: keyof typeof EXPECTED, shot: string) {
  const want = EXPECTED[range];
  const clicks = tile(page, "Total clicks");
  const unique = tile(page, "Unique visitors (approx.)");

  await page.locator("main").getByRole("button", { name: range, exact: true }).click();
  await expect(clicks.locator(".font-display")).toHaveText(want.toLocaleString());

  // The tile is what the analytics endpoint says for this link and range…
  const api = await getJson<AnalyticsRes>(session, `/analytics?range=${range}&linkId=${linkId}`);
  expect(api.totals.clicks, `API ${range} total`).toBe(want);
  await expect(unique.locator(".font-display")).toHaveText(api.totals.unique.toLocaleString());
  // …it states its window, and the all-time figure is labelled and different.
  await expect(clicks).toContainText(range);
  await expect(clicks).toContainText(DELTA[range]);
  await expect(clicks).toContainText(`${ALL_TIME.toLocaleString()} all-time`);
  await expect(clicks.locator(".font-display")).not.toHaveText(ALL_TIME.toLocaleString());
  // The breakdown under it adds up to it.
  const rows = await card(page, "Countries").locator("span.font-semibold.tnum").allInnerTexts();
  expect(rows.map(num).reduce((a, b) => a + b, 0), `${range} countries sum`).toBe(want);

  if (EVIDENCE) await page.screenshot({ path: path.join(EVIDENCE, shot), fullPage: true });
}

test.describe("Journey 768 — link detail scope", () => {
  test.setTimeout(240_000);

  test("desktop: every range tab keeps value, delta and breakdowns in one scope", async ({ page }) => {
    const { session, linkId } = await seedLink("desk");
    await seedAccount(page, session);
    await page.goto(`/links/${linkId}`);
    await expect(page.getByText("Total clicks")).toBeVisible({ timeout: 20_000 });

    await checkRange(page, session, linkId, "30d", "desktop-30d.png");
    await checkRange(page, session, linkId, "24h", "desktop-24h.png");
    await checkRange(page, session, linkId, "12m", "desktop-12m.png");
    await checkRange(page, session, linkId, "30d", "desktop-30d-again.png");
  });

  test("@mobile: the same on a phone", async ({ page }) => {
    const { session, linkId } = await seedLink("mob");
    await seedAccount(page, session);
    await page.goto(`/links/${linkId}`);
    await expect(page.getByText("Total clicks")).toBeVisible({ timeout: 20_000 });

    await checkRange(page, session, linkId, "30d", "mobile-30d.png");
    await checkRange(page, session, linkId, "24h", "mobile-24h.png");
  });
});
