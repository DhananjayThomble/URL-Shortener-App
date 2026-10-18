import { devices, expect, test, type Page } from "@playwright/test";
import { MOCK_USER, MOCK_WORKSPACE, mockApi, seedMockSession } from "../support/mock-api";

/* #769 — the Analytics header said "3 years retention" whatever the workspace
   had saved. This lane uses the REAL API client and React Query cache (fixtures
   mode bypasses both), so it can show the label following GET/PATCH
   /workspaces/current and the cached value being replaced after a Settings save.
   Shapes: packages/contract/src/{workspace,analytics}.ts. */

const BASE = "No cookies set · click data never sold";

const ANALYTICS = {
  totals: { clicks: 10, unique: 5, scans: 1, conversions: 0, blocked: 0 },
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

const workspaceWith = (retentionYears: number) => ({ ...MOCK_WORKSPACE, retentionYears });

const common = {
  "GET /auth/me": { status: 200, body: MOCK_USER },
  "GET /auth/workspaces": { status: 200, body: [] },
  "GET /analytics": { status: 200, body: ANALYTICS },
} as const;

/** Client-side navigation (keeps the React Query cache) through whichever nav is visible. */
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

for (const [name, use] of [
  ["desktop", { viewport: { width: 1440, height: 900 } }],
  // defaultBrowserType forces a new worker and cannot be set inside a describe.
  ["mobile", (({ defaultBrowserType: _ignored, ...rest }) => rest)(devices["Pixel 7"])],
] as const) {
  test.describe(`analytics header retention (#769) — ${name}`, () => {
    test.use(use);

    test.beforeEach(async ({ page }) => {
      await seedMockSession(page);
    });

    for (const [years, text] of [
      [1, "1 year retention"],
      [3, "3 years retention"],
      [7, "7 years retention"],
      [100, "maximum retention"],
    ] as const) {
      test(`workspace retention ${years} renders "${text}"`, async ({ page }) => {
        await mockApi(page, { ...common, "GET /workspaces/current": { status: 200, body: workspaceWith(years) } });
        await page.goto("/analytics");
        await expect(page.getByText(`${BASE} · ${text}`, { exact: true })).toBeVisible();
        if (years !== 3) await expect(page.getByText("3 years retention")).toHaveCount(0);
      });
    }

    test("saving a different retention in Settings updates the header without a reload", async ({ page }) => {
      let current = 3;
      const api = await mockApi(page, {
        ...common,
        "GET /workspaces/current": () => ({ status: 200, body: workspaceWith(current) }),
        "PATCH /workspaces/current": (req) => {
          current = (req.body as { retentionYears: number }).retentionYears;
          return { status: 200, body: workspaceWith(current) };
        },
      });

      await page.goto("/analytics");
      await expect(page.getByText(`${BASE} · 3 years retention`, { exact: true })).toBeVisible();

      // Client-side navigation keeps the React Query cache — the stale-cache case.
      await goTo(page, "Settings", /\/settings$/);
      await page.getByRole("button", { name: "1 year" }).click();
      await page.getByRole("button", { name: "Save changes" }).click();
      // #780: a shorter window asks before it deletes anything.
      await page.getByRole("alertdialog").getByRole("button", { name: "Delete older data and save" }).click();
      await expect.poll(() => api.callsTo("PATCH", "/workspaces/current").length).toBe(1);
      expect(api.callsTo("PATCH", "/workspaces/current")[0]!.body).toMatchObject({ retentionYears: 1 });

      await expect(page.getByText("Saved.")).toBeVisible();

      await goTo(page, "Analytics", /\/analytics$/);
      await expect(page.getByText(`${BASE} · 1 year retention`, { exact: true })).toBeVisible();
      await expect(page.getByText("3 years retention")).toHaveCount(0);
    });

    test("an unreadable workspace makes no retention claim", async ({ page }) => {
      await mockApi(page, {
        ...common,
        "GET /workspaces/current": { status: 500, body: { statusCode: 500, message: "boom" } },
      });
      await page.goto("/analytics");
      await expect(page.getByText(BASE, { exact: true })).toBeVisible();
      await expect(page.getByText(/retention/)).toHaveCount(0);
    });
  });
}
