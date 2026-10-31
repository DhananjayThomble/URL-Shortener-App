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
      // A malformed id is covered separately — see the test.fail below (#908):
      // the dashboard shows "Link not found", but the analytics call the detail
      // page makes 500s on a non-UUID linkId instead of a 400, which is a real
      // API bug. Driving it here would also emit the error-level log that the
      // real-stack CI gate fails on, so it lives in its own annotated test.
    });

    /* #908: GET /api/v1/analytics does not validate linkId as a UUID, so a
       malformed value (what the link-detail page sends for /links/not-a-uuid)
       reaches Postgres and 500s with an unhandled DB exception logged at error
       level, instead of a 400. Oracle: packages/contract/src/analytics.ts — the
       sibling schema already uses z.string().uuid("linkId must be a link id"),
       and a bad input is a 400 everywhere else (cf. j754). test.fail until #908
       lands; it also trips the api error-log gate, which is the gate doing its
       job. Does not depend on the browser, so it runs once (desktop only). */
    test(`a non-UUID analytics linkId is a 400, not a 500 (#908)`, async ({}, info) => {
      test.skip(info.project.name !== "desktop", "API-only; run once");
      test.fail(true, "#908: analytics linkId is not validated as a UUID; a non-UUID 500s");
      const user = await register(makeEmail(`j790-908-${scheme}`));
      const res = await fetch(`${API_URL}/analytics?range=30d&linkId=not-a-uuid`, {
        headers: { authorization: `Bearer ${user.accessToken}` },
      });
      expect(res.status, "a malformed linkId is a contract 400, never a 500").toBe(400);
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
