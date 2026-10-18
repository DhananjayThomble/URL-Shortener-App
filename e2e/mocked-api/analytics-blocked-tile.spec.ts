import { devices, expect, test } from "@playwright/test";
import { MOCK_USER, MOCK_WORKSPACE, mockApi, seedMockSession } from "../support/mock-api";

/* #767 — the Analytics "Blocked / unsafe" tile showed `totals.blocked`, which is
   sum(click_daily.blocked): EVERY gate rejection the redirect records (expired,
   scheduled, click_limit, archived, flagged). Its caption claimed "Safe Browsing",
   so a workspace with only expired/scheduled/limit rejections saw a non-zero
   "unsafe" count although nothing was ever flagged. The rollup keeps no per-reason
   split, so the tile is relabelled to what it counts. This lane uses the real API
   client with the payload the API would send (packages/contract/src/analytics.ts). */

const ANALYTICS = {
  // Mirrors the QA workspace in the issue: 1 expired + 1 scheduled + 2 click_limit.
  totals: { clicks: 4, unique: 3, scans: 0, conversions: 0, blocked: 4 },
  deltas: { clicks: null, unique: null, scans: null, conversions: null },
  series: [],
  countries: [],
  cities: [],
  devices: [],
  browsers: [],
  referrers: [],
  tags: [],
  topLinks: [],
};

const common = {
  "GET /auth/me": { status: 200, body: MOCK_USER },
  "GET /auth/workspaces": { status: 200, body: [] },
  "GET /workspaces/current": { status: 200, body: MOCK_WORKSPACE },
} as const;

const CAPTION = "Expired, scheduled, over limit, archived or unsafe";

for (const [name, use] of [
  [
    "desktop",
    { viewport: { width: 1440, height: 900 } },
  ],
  // defaultBrowserType forces a new worker and cannot be set inside a describe.
  ["mobile", (({ defaultBrowserType: _ignored, ...rest }) => rest)(devices["Pixel 7"])],
] as const) {
  test.describe(`analytics blocked tile (#767) — ${name}`, () => {
    test.use(use);

    test.beforeEach(async ({ page }) => {
      await seedMockSession(page);
    });

    test("the tile is labelled for every rejection it counts, not only Safe Browsing", async ({ page }) => {
      await mockApi(page, { ...common, "GET /analytics": { status: 200, body: ANALYTICS } });
      await page.goto("/analytics");

      await expect(page.getByText("Blocked visits", { exact: true })).toBeVisible();
      await expect(page.getByText(CAPTION, { exact: true })).toBeVisible();

      // The tile shows the real total (4 = 1 expired + 1 scheduled + 2 click limit).
      const tile = page.getByText("Blocked visits", { exact: true }).locator("xpath=..");
      await expect(tile).toContainText("4");

      // The misleading copy is gone.
      await expect(page.getByText("Blocked / unsafe")).toHaveCount(0);
      await expect(page.getByText("Safe Browsing", { exact: true })).toHaveCount(0);
    });

    test("zero blocked visits still reads as a plain count", async ({ page }) => {
      await mockApi(page, {
        ...common,
        "GET /analytics": { status: 200, body: { ...ANALYTICS, totals: { ...ANALYTICS.totals, blocked: 0 } } },
      });
      await page.goto("/analytics");
      const tile = page.getByText("Blocked visits", { exact: true }).locator("xpath=..");
      await expect(tile).toContainText("0");
      await expect(page.getByText(CAPTION, { exact: true })).toBeVisible();
    });

    test("the caption wraps inside the tile without horizontal overflow", async ({ page }) => {
      await mockApi(page, { ...common, "GET /analytics": { status: 200, body: ANALYTICS } });
      await page.goto("/analytics");
      const tile = page.getByText("Blocked visits", { exact: true }).locator("xpath=..");
      await expect(tile).toBeVisible();
      const overflow = await page.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth);
      expect(overflow).toBe(false);
      const caption = page.getByText(CAPTION, { exact: true });
      const [t, c] = await Promise.all([tile.boundingBox(), caption.boundingBox()]);
      expect(c!.x + c!.width).toBeLessThanOrEqual(t!.x + t!.width + 0.5);
    });
  });
}
