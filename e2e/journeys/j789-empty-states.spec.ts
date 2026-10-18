/**
 * Journey 789 — a brand-new workspace sees real empty states on Bio, Developers
 * and Conversions, each action does what it says, and the funnel's labels are
 * never cut off.
 *
 * QA saw blank tables and a blank preview on /bio, empty tables with scrollbars on
 * /developers, and blank panels with clipped funnel labels ("Signu") on /conversions.
 *
 * Oracles (what the PERSON sees):
 *   - the shared EmptyState: a heading that says what is missing and ONE action;
 *   - the action's observable effect against the REAL API (a form opens; after
 *     saving, the empty state is replaced by the thing just created);
 *   - the funnel: every step label is wholly on screen, inside its card, and not
 *     drawn over a bar (the bar is as narrow as the step is small);
 *   - no rate is drawn with two decimals, none is NaN.
 *
 * Screenshots are viewport-only at deviceScaleFactor 1 (never fullPage).
 * One registration per viewport (the register endpoint is throttled).
 */

import { mkdirSync } from "node:fs";
import path from "node:path";
import { randomBytes } from "node:crypto";
import { expect, test, type Page } from "@playwright/test";
import { API_URL, REDIRECT_URL, makeEmail, registerUser, seedAccount, createLink } from "./helpers";

const EVIDENCE = path.resolve(__dirname, "../../.qa-runs/789");
const BROWSER_UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36";

async function shot(page: Page, name: string) {
  await page.evaluate(() => window.scrollTo(0, 0));
  await page.screenshot({ path: path.join(EVIDENCE, `${name}.png`), fullPage: false });
}

async function sideways(page: Page) {
  return page.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth);
}

test.describe("Journey 789 — empty states @mobile", () => {
  test("new account: three empty states, working actions, unclipped funnel", async ({ page }, testInfo) => {
    mkdirSync(EVIDENCE, { recursive: true });
    const tag = testInfo.project.name;
    const session = await registerUser(makeEmail(`j789-${tag}`));
    await seedAccount(page, session);

    /* ---- /bio ---- */
    await page.goto("/bio");
    await expect(page.getByRole("heading", { name: "Create your first bio page" })).toBeVisible();
    await expect(page.getByTestId("bio-preview")).toHaveCount(0);
    await expect(page.getByRole("region", { name: "Your pages" })).toHaveCount(0);
    expect(await sideways(page), "/bio scrolls sideways").toBe(false);
    await shot(page, `bio-empty-${tag}`);

    await page.getByRole("button", { name: "Create your first page" }).click();
    await expect(page.getByPlaceholder("yourname")).toBeFocused();
    const slug = `j789${randomBytes(3).toString("hex")}`;
    await page.getByPlaceholder("yourname").fill(slug);
    await page.getByPlaceholder("Acme Growth").fill("Journey 789");
    await page.getByRole("button", { name: "Create as draft" }).click();
    // Observable effect: the empty state is replaced by the page just created, with its editor + preview.
    await expect(page.getByRole("row", { name: new RegExp(`/${slug}`) })).toBeVisible();
    await expect(page.getByRole("heading", { name: "Create your first bio page" })).toHaveCount(0);
    await expect(page.getByTestId("bio-preview")).toBeVisible();

    /* ---- /developers ---- */
    await page.goto("/developers");
    await expect(page.getByRole("heading", { name: "No API keys yet" })).toBeVisible();
    await expect(page.getByRole("heading", { name: "No webhooks yet" })).toBeVisible();
    await expect(page.getByRole("region", { name: "API keys" })).toHaveCount(0);
    await expect(page.getByRole("region", { name: "Webhooks" })).toHaveCount(0);
    expect(await sideways(page), "/developers scrolls sideways").toBe(false);
    await shot(page, `developers-empty-${tag}`);

    await page.getByRole("button", { name: "Create an API key" }).click();
    await page.getByPlaceholder("CI deploy bot").fill("Journey 789 key");
    await page.getByRole("button", { name: "Create key", exact: true }).click();
    await expect(page.getByRole("heading", { name: "Copy this key now" })).toBeVisible();
    await expect(page.getByRole("heading", { name: "No API keys yet" })).toHaveCount(0);
    await expect(page.getByRole("region", { name: "API keys" }).getByText("Journey 789 key")).toBeVisible();
    // The webhooks panel is untouched.
    await expect(page.getByRole("heading", { name: "No webhooks yet" })).toBeVisible();

    /* ---- /conversions: nothing at all ---- */
    await page.goto("/conversions");
    await expect(page.getByRole("heading", { name: "No clicks in this range" })).toBeVisible();
    await expect(page.getByRole("heading", { name: "No events tracked yet" })).toBeVisible();
    await expect(page.getByRole("heading", { name: "No revenue by link yet" })).toBeVisible();
    await expect(page.getByRole("region", { name: "Revenue by link" })).toHaveCount(0);
    const emptyText = await page.locator("main").innerText();
    expect(emptyText).not.toMatch(/NaN|Infinity|\d\.\d\d%/);
    expect(await sideways(page), "/conversions scrolls sideways").toBe(false);
    await shot(page, `conversions-empty-${tag}`);
    await page.getByRole("link", { name: "Create a link" }).click();
    await expect(page).toHaveURL(/\/links$/);

    /* ---- /conversions: clicks, no conversions -> the narrowest funnel bars ---- */
    const link = await createLink(session.accessToken, { destination: "https://example.com/j789-target" });
    for (let i = 0; i < 3; i++) {
      await fetch(`${REDIRECT_URL}/${link.slug}`, { redirect: "manual", headers: { "user-agent": BROWSER_UA } });
    }
    let clicks = 0;
    for (let i = 0; i < 30 && clicks < 3; i++) {
      const r = await fetch(`${API_URL}/conversions?range=30d`, { headers: { authorization: `Bearer ${session.accessToken}` } });
      clicks = ((await r.json()) as { totals: { clicks: number } }).totals.clicks;
      if (clicks < 3) await new Promise((res) => setTimeout(res, 5000));
    }
    expect(clicks, "rollup counted the driven clicks").toBeGreaterThanOrEqual(3);

    await page.goto("/conversions");
    const funnel = page.getByRole("list", { name: "Conversion funnel" });
    await expect(funnel).toBeVisible();
    const card = (await funnel.boundingBox())!;
    for (const label of ["Clicks", "Leads", "Signups", "Paid"]) {
      const el = funnel.getByText(label, { exact: true });
      await expect(el).toBeVisible();
      const box = (await el.boundingBox())!;
      expect(box.x).toBeGreaterThanOrEqual(card.x);
      expect(box.x + box.width).toBeLessThanOrEqual(card.x + card.width + 0.5);
      expect(await el.evaluate((n) => n.scrollWidth > n.clientWidth + 1), `${label} clipped`).toBe(false);
      const track = (await el.locator("xpath=ancestor::li[1]").locator('[aria-hidden="true"]').boundingBox())!;
      expect(box.y + box.height, `${label} overlaps its bar`).toBeLessThanOrEqual(track.y + 0.5);
    }
    const text = await page.locator("main").innerText();
    expect(text).not.toMatch(/NaN|Infinity|\d\.\d\d%/);
    // The panels that still have nothing to show keep saying so.
    await expect(page.getByRole("heading", { name: "No events tracked yet" })).toBeVisible();
    await funnel.scrollIntoViewIfNeeded();
    await shot(page, `conversions-funnel-${tag}`);
    await funnel.screenshot({ path: path.join(EVIDENCE, `funnel-${tag}.png`) });
  });
});
