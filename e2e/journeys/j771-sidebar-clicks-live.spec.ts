/**
 * Journey 771 — the sidebar "Clicks this month" catches up without a reload  @mobile
 *
 * Open /links with a fresh workspace (sidebar shows 0), drive real-browser
 * clicks through the redirect service, and WITHOUT reloading or navigating
 * assert the sidebar count follows the worker's rollup (~30-60 s).
 *
 * Oracle: ground truth is the number of clicks driven. Rollups only count
 * non-bot traffic, so every click carries a real browser User-Agent.
 * Contract: packages/contract/src/workspace.ts (clicksUsed).
 */

import { expect, test, type Page } from "@playwright/test";
import { REDIRECT_URL, createLink, makeEmail, registerUser, seedAccount } from "./helpers";

const CHROME_UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36";
const CLICKS = 3;

async function drive(slug: string, n: number): Promise<void> {
  for (let i = 0; i < n; i++) {
    await fetch(`${REDIRECT_URL}/${slug}`, { redirect: "manual", headers: { "user-agent": CHROME_UA } });
  }
}

/** The sidebar value on desktop; on mobile the drawer is opened just to read it. */
async function sidebarClicks(page: Page): Promise<number> {
  const hamburger = page.getByRole("button", { name: "Open navigation menu" });
  const mobile = await hamburger.isVisible();
  if (mobile) await hamburger.click();
  const scope = mobile ? page.getByRole("dialog", { name: "Navigation" }) : page.getByRole("complementary");
  const text = (await scope.getByText("Clicks this month").locator("xpath=..").locator("b").textContent()) ?? "";
  if (mobile) {
    await page.keyboard.press("Escape");
    await expect(scope).toBeHidden();
  }
  return Number(text.replace(/[^0-9]/g, ""));
}

test("sidebar clicks this month follows new clicks without a reload @mobile", async ({ page }, info) => {
  test.setTimeout(240_000);
  const tag = info.project.name;

  const session = await registerUser(makeEmail(`j771-${tag}`));
  const link = await createLink(session.accessToken, { destination: "https://example.com/j771" });
  await seedAccount(page, session);
  await page.goto("/links");
  await expect(page.getByText(link.slug).first()).toBeVisible();
  expect(await sidebarClicks(page)).toBe(0);

  await drive(link.slug, CLICKS);

  // No reload, no navigation: only the sidebar's own refresh may move the number.
  await expect.poll(() => sidebarClicks(page), { timeout: 180_000, intervals: [5_000] }).toBe(CLICKS);
  await page.screenshot({ path: `.qa-runs/771/real-${tag}-after.png` });
});
