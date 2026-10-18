/**
 * Journey — the Analytics header states the workspace's own retention (#769)
 *
 * The header used to say "3 years retention" whatever Settings held. A person
 * (workspace owner, fresh workspace) then:
 *   1. opens /analytics: the schema default (3 years, packages/database
 *      identity.ts) is what the header says — because it is the setting, not a
 *      literal;
 *   2. goes to Settings through the app's own navigation (React Query cache
 *      kept), picks "1 year", saves;
 *   3. goes back to Analytics: the header now says "1 year retention" with no
 *      reload; a hard reload agrees (the API, not the cache, holds the truth);
 *   4. picks "Forever": the header does not claim a number of years.
 *
 * Oracles: the issue's acceptance criteria; PATCH /workspaces/current persists
 * retentionYears (read back through the API below). What the PERSON reads.
 *
 * Requires the local staging stack + web on :3000. @mobile: also runs on the
 * mobile project.
 */

import { expect, test, type Page } from "@playwright/test";
import { API_URL, makeEmail, registerUser, seedAccount } from "./helpers";

const BASE = "No cookies set · click data never sold";

async function goTo(page: Page, label: string, urlRe: RegExp) {
  const hamburger = page.getByRole("button", { name: "Open navigation menu" });
  if (await hamburger.isVisible()) {
    await hamburger.click();
    await page.getByRole("dialog", { name: "Navigation" }).getByRole("link", { name: label }).click();
  } else {
    await page.getByRole("complementary").getByRole("link", { name: label }).click();
  }
  await expect(page).toHaveURL(urlRe);
}

async function savedRetention(accessToken: string): Promise<number> {
  const res = await fetch(`${API_URL}/workspaces/current`, { headers: { authorization: `Bearer ${accessToken}` } });
  expect(res.status, "read the workspace").toBe(200);
  return ((await res.json()) as { retentionYears: number }).retentionYears;
}

test.describe("Journey — analytics header retention (#769)", () => {
  test("@mobile the header follows the saved retention, including after a Settings change", async ({ page }) => {
    const session = await registerUser(makeEmail("j769"));
    await seedAccount(page, session);

    // 1. The workspace's own (default) value.
    await page.goto("/analytics");
    await expect(page.getByText(`${BASE} · 3 years retention`, { exact: true })).toBeVisible({ timeout: 15_000 });

    // 2. Change it in Settings via in-app navigation (keeps the query cache).
    await goTo(page, "Settings", /\/settings$/);
    await page.getByRole("button", { name: "1 year" }).click();
    await page.getByRole("button", { name: "Save changes" }).click();
    await expect(page.getByText("Saved.")).toBeVisible();
    expect(await savedRetention(session.accessToken)).toBe(1);

    // 3. Back on Analytics: the new value, no stale "3 years".
    await goTo(page, "Analytics", /\/analytics$/);
    await expect(page.getByText(`${BASE} · 1 year retention`, { exact: true })).toBeVisible();
    await expect(page.getByText("3 years retention")).toHaveCount(0);

    // ...and a hard reload (cache gone, API is the source) says the same.
    await page.reload();
    await expect(page.getByText(`${BASE} · 1 year retention`, { exact: true })).toBeVisible({ timeout: 15_000 });

    // 4. "Forever" must not be worded as a number of years.
    await goTo(page, "Settings", /\/settings$/);
    await page.getByRole("button", { name: "Forever" }).click();
    await page.getByRole("button", { name: "Save changes" }).click();
    await expect(page.getByText("Saved.")).toBeVisible();
    await goTo(page, "Analytics", /\/analytics$/);
    await expect(page.getByText(`${BASE} · maximum retention`, { exact: true })).toBeVisible();
  });
});
