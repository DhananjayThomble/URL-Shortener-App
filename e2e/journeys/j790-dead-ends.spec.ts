/**
 * Journey 790 — Dead ends: a not-found link page, a dismissed report  @mobile
 *
 * Before #790 a link detail page for a link that is not there (or is in another
 * workspace) offered only "Try again", and a dismissed abuse report still
 * showed "Dismiss".
 *
 *   another workspace's link id  -> "Link not found" + Back to links, no retry, no leak
 *   a never-existing link id     -> the same state
 *   dismiss a report             -> row reads Dismissed, no Dismiss, survives a reload
 *
 * Oracles: the link/report come from the real API (POST /links, POST
 * /public/links/:slug/report, never typed); the "no leak" check compares the page
 * text against the OTHER workspace's real slug and destination; the reload checks
 * the persisted status from GET /reports. Light and dark are both exercised.
 *
 * Registration is throttled (5/min per IP) so sign-ups back off on a 429.
 */

import { expect, test } from "@playwright/test";
import { API_URL, createLink, makeEmail, registerUser, seedAccount, type Session } from "./helpers";

async function register(email: string): Promise<Session> {
  for (let attempt = 0; ; attempt++) {
    try {
      return await registerUser(email);
    } catch (err) {
      if (attempt >= 4 || !/429/.test((err as Error).message)) throw err;
      await new Promise((r) => setTimeout(r, 20_000));
    }
  }
}

for (const scheme of ["light", "dark"] as const) {
  test.describe(`Journey 790 — dead ends (${scheme})`, () => {
    test.use({ colorScheme: scheme });

    test(`another workspace's link and a missing id read as not found, with a way back @mobile`, async ({ page, baseURL }, info) => {
      const owner = await register(makeEmail(`j790-owner-${scheme}-${info.project.name}`));
      const outsider = await register(makeEmail(`j790-out-${scheme}-${info.project.name}`));
      const secretDestination = `https://example.com/j790-private-${Date.now().toString(36)}`;
      const link = await createLink(owner.accessToken, { destination: secretDestination });

      await seedAccount(page, outsider);
      const detailRequests: string[] = [];
      page.on("request", (r) => {
        if (r.url().startsWith(API_URL) && new URL(r.url()).pathname.endsWith(`/links/${link.id}`)) detailRequests.push(r.method());
      });

      await page.goto(`/links/${link.id}`);
      const main = page.locator("main");
      await expect(main.getByRole("heading", { name: "Link not found" })).toBeVisible({ timeout: 20_000 });
      await expect(main.getByRole("button", { name: "Try again" })).toHaveCount(0);
      // Nothing about the other workspace's link reaches the page.
      const text = await page.locator("body").innerText();
      expect(text).not.toContain(link.slug);
      expect(text).not.toContain(secretDestination);
      // No retry loop.
      await page.waitForTimeout(2000);
      expect(detailRequests).toEqual(["GET"]);
      await page.screenshot({ path: info.outputPath(`not-found-other-workspace-${scheme}-${info.project.name}.png`) });

      const back = main.getByRole("link", { name: "Back to links" });
      await back.click();
      await expect(page).toHaveURL(`${baseURL}/links`);

      // An id that never existed at all reads the same.
      await page.goto("/links/0191f6a0-0000-7000-8000-00000000dead");
      await expect(main.getByRole("heading", { name: "Link not found" })).toBeVisible({ timeout: 20_000 });
      await expect(main.getByRole("link", { name: "Back to links" })).toBeVisible();
      // And a malformed one (the API's 400) does too, without its raw validation text.
      await page.goto("/links/not-a-uuid");
      await expect(main.getByRole("heading", { name: "Link not found" })).toBeVisible({ timeout: 20_000 });
      await expect(main.getByText(/uuid|validation/i)).toHaveCount(0);
    });

    test(`dismissing a report removes Dismiss, shows the new state, and it persists @mobile`, async ({ page }, info) => {
      const owner = await register(makeEmail(`j790-rep-${scheme}-${info.project.name}`));
      const link = await createLink(owner.accessToken, { destination: "https://example.com/j790-report" });
      const reason = `j790 phishing report ${scheme}-${info.project.name}`;
      const filed = await fetch(`${API_URL}/public/links/${encodeURIComponent(link.slug)}/report`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ reason }),
      });
      expect(filed.ok, "POST /public/links/:slug/report").toBe(true);

      await seedAccount(page, owner);
      await page.goto("/reports");
      const row = page.locator("main tbody tr").filter({ hasText: reason });
      await expect(row).toBeVisible({ timeout: 20_000 });
      await expect(row).toContainText("Open");
      await page.screenshot({ path: info.outputPath(`report-open-${scheme}-${info.project.name}.png`) });

      await row.getByRole("button", { name: `Dismiss report on /${link.slug}` }).click();
      await expect(row).toContainText("Dismissed", { timeout: 15_000 });
      await expect(row.getByRole("button", { name: `Dismiss report on /${link.slug}` })).toHaveCount(0);
      await page.screenshot({ path: info.outputPath(`report-dismissed-${scheme}-${info.project.name}.png`) });

      // The server really holds it, and a reload shows the same.
      const listed = (await (
        await fetch(`${API_URL}/reports`, { headers: { authorization: `Bearer ${owner.accessToken}` } })
      ).json()) as { reason: string; status: string }[];
      expect(listed.find((r) => r.reason === reason)?.status).toBe("dismissed");
      await page.reload();
      const after = page.locator("main tbody tr").filter({ hasText: reason });
      await expect(after).toContainText("Dismissed", { timeout: 20_000 });
      await expect(after.getByRole("button", { name: `Dismiss report on /${link.slug}` })).toHaveCount(0);
    });
  });
}
