import { devices, expect, test, type Locator, type Page } from "@playwright/test";
import { MOCK_USER, MOCK_WORKSPACE, mockApi, seedMockSession } from "../support/mock-api";

/* #768 — the link detail page showed the link's ALL-TIME click counter as the
   "Total clicks" headline while the delta beside it and every breakdown below
   came from GET /analytics?range=…&linkId=… (the selected window).

   Oracle: the issue's acceptance criteria — the headline tiles show the
   range-scoped totals from the analytics response, a delta and breakdowns of the
   same scope sit beside them, and any all-time figure is labelled as such.
   Shapes: packages/contract/src/{link,analytics}.ts.

   This lane uses the REAL API client and React Query cache (fixtures mode would
   bypass both), so the numbers come from the mocked /links/:id and /analytics
   replies, one analytics reply per range. */

const LINK_ID = "0191f6a0-0000-7000-8000-000000000768";
const ALL_TIME_CLICKS = 21504;
const ALL_TIME_UNIQUE = 17000;

const LINK = {
  id: LINK_ID,
  domain: "snap.to",
  slug: "webinar-q3",
  destination: "https://example.com/webinar",
  status: "active",
  clicks: ALL_TIME_CLICKS,
  uniqueClicks: ALL_TIME_UNIQUE,
  redirectType: "302",
  rules: [],
  tags: [],
  safeBrowsing: { status: "clean", checkedAt: "2026-10-01T00:00:00.000Z" },
  sparkline: [],
  createdAt: "2026-07-01T00:00:00.000Z",
};

const blank = { countries: [], cities: [], devices: [], browsers: [], referrers: [], tags: [], topLinks: [] };

/** One analytics reply per range. Each is internally consistent: the country rows sum to totals.clicks. */
const BY_RANGE = {
  "24h": {
    totals: { clicks: 41, unique: 30, scans: 0, conversions: 3, blocked: 0 },
    deltas: { clicks: null, unique: null, scans: null, conversions: null },
    series: [{ date: "2026-10-18", clicks: 41, unique: 30, scans: 0 }],
    ...blank,
    countries: [
      { label: "India", value: 40, icon: "🇮🇳" },
      { label: "Singapore", value: 1, icon: "🇸🇬" },
    ],
  },
  "30d": {
    totals: { clicks: 9207, unique: 7100, scans: 0, conversions: 0, blocked: 0 },
    deltas: { clicks: 29.1, unique: -4.2, scans: null, conversions: null },
    series: [{ date: "2026-10-17", clicks: 9207, unique: 7100, scans: 0 }],
    ...blank,
    countries: [
      { label: "India", value: 6000, icon: "🇮🇳" },
      { label: "United States", value: 3207, icon: "🇺🇸" },
    ],
  },
  "12m": {
    totals: { clicks: 21000, unique: 16500, scans: 0, conversions: 0, blocked: 0 },
    deltas: { clicks: 310.5, unique: 280.1, scans: null, conversions: null },
    series: [{ date: "2026-10-17", clicks: 21000, unique: 16500, scans: 0 }],
    ...blank,
    countries: [
      { label: "India", value: 14000, icon: "🇮🇳" },
      { label: "United States", value: 7000, icon: "🇺🇸" },
    ],
  },
} as const;

type R = keyof typeof BY_RANGE;

const common = {
  "GET /auth/me": { status: 200, body: MOCK_USER },
  "GET /auth/workspaces": { status: 200, body: [] },
  "GET /workspaces/current": { status: 200, body: MOCK_WORKSPACE },
  [`GET /links/${LINK_ID}`]: { status: 200, body: LINK },
} as const;

const analyticsFor = (range: string | null) => BY_RANGE[(range ?? "30d") as R] ?? BY_RANGE["30d"];

/** The stat tile a label belongs to (Tile root is the nearest `bg-surface` ancestor). */
const tile = (page: Page, label: string): Locator =>
  page.locator("main").getByText(label, { exact: true }).locator("xpath=ancestor::div[contains(@class,'bg-surface')][1]");

const card = (page: Page, title: string): Locator =>
  page.getByRole("heading", { name: title, exact: true }).locator("xpath=ancestor::div[contains(@class,'bg-surface')][1]");

/** Sum of the numeric values in a breakdown card. */
async function breakdownSum(c: Locator): Promise<number> {
  const texts = await c.locator("span.font-semibold.tnum").allInnerTexts();
  return texts.reduce((a, t) => a + Number(t.replace(/,/g, "")), 0);
}

for (const [name, use] of [
  ["desktop", { viewport: { width: 1440, height: 900 } }],
  // defaultBrowserType forces a new worker and cannot be set inside a describe.
  ["mobile", (({ defaultBrowserType: _ignored, ...rest }) => rest)(devices["Pixel 7"])],
] as const) {
  test.describe(`link detail scope (#768) — ${name}`, () => {
    test.use(use);

    test.beforeEach(async ({ page }) => {
      await seedMockSession(page);
    });

    test("headline totals, delta and breakdowns all describe the selected range; all-time is labelled", async ({ page }) => {
      const api = await mockApi(page, {
        ...common,
        "GET /analytics": (req) => ({ status: 200, body: analyticsFor(req.query?.range ?? null) }),
      });
      await page.goto(`/links/${LINK_ID}`);

      const clicks = tile(page, "Total clicks");
      const unique = tile(page, "Unique visitors (approx.)");

      // 30d (default): the range total, not the 21,504 all-time counter.
      await expect(clicks).toContainText("9,207");
      await expect(clicks).toContainText("29.1%");
      await expect(clicks).toContainText("vs prev 30d");
      await expect(unique).toContainText("7,100");
      // The scope is stated on the tile, and the all-time figure is labelled as such.
      await expect(clicks).toContainText("30d");
      await expect(clicks).toContainText("21,504 all-time");
      await expect(unique).toContainText("17,000 all-time");
      // 21,504 never stands as the headline value.
      await expect(clicks.locator(".font-display")).toHaveText("9,207");
      await expect(unique.locator(".font-display")).toHaveText("7,100");
      // The breakdown beneath adds up to the headline it sits under.
      expect(await breakdownSum(card(page, "Countries"))).toBe(9207);

      // The Conversions tile is range-scoped too, so it states its window —
      // the review's blocking finding was that it did not.
      await expect(tile(page, "Conversions")).toContainText("30d");

      expect(api.callsTo("GET", "/analytics").at(-1)!.query?.linkId).toBe(LINK_ID);

      // Each other window re-scopes the whole page together.
      for (const [range, clickValue, uniqueValue, deltaText] of [
        ["24h", "41", "30", "vs prev 24h"],
        ["12m", "21,000", "16,500", "vs prev 12m"],
        ["30d", "9,207", "7,100", "vs prev 30d"],
      ] as const) {
        await page.locator("main").getByRole("button", { name: range, exact: true }).click();
        await expect(clicks.locator(".font-display")).toHaveText(clickValue);
        await expect(unique.locator(".font-display")).toHaveText(uniqueValue);
        await expect(clicks).toContainText(range);
        if (deltaText !== "vs prev 24h") await expect(clicks).toContainText(deltaText);
        await expect(clicks).toContainText("21,504 all-time");
        // Conversions keeps its scope label on every range, including 24h where
        // its delta is null (the review's second blocking finding).
        await expect(tile(page, "Conversions")).toContainText(range);
        expect(await breakdownSum(card(page, "Countries"))).toBe(Number(clickValue.replace(/,/g, "")));
      }
    });

    test("a quiet range on a busy link reads 0, not the all-time counter", async ({ page }) => {
      await mockApi(page, {
        ...common,
        "GET /analytics": {
          status: 200,
          body: {
            totals: { clicks: 0, unique: 0, scans: 0, conversions: 0, blocked: 0 },
            deltas: { clicks: null, unique: null, scans: null, conversions: null },
            series: [],
            ...blank,
          },
        },
      });
      await page.goto(`/links/${LINK_ID}`);
      const clicks = tile(page, "Total clicks");
      await expect(clicks.locator(".font-display")).toHaveText("0");
      await expect(clicks).toContainText("21,504 all-time");
    });

    test("while the range loads the tile shows a dash, never the all-time counter in its place", async ({ page }) => {
      await mockApi(page, { ...common, "GET /analytics": { status: 200, body: BY_RANGE["30d"] } });
      // Registered after mockApi, so it wins: hold the analytics reply until released.
      let release!: () => void;
      const gate = new Promise<void>((r) => (release = r));
      await page.route("**/api/v1/analytics*", async (route) => {
        await gate;
        await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(BY_RANGE["30d"]) });
      });
      await page.goto(`/links/${LINK_ID}`);

      const clicks = tile(page, "Total clicks");
      await expect(clicks).toContainText("21,504 all-time");
      await expect(clicks.locator(".font-display")).toHaveText("—");
      await expect(tile(page, "Unique visitors (approx.)").locator(".font-display")).toHaveText("—");

      release();
      await expect(clicks.locator(".font-display")).toHaveText("9,207");
    });

    test("if the range cannot be loaded the headline is a dash with a retry, not the all-time counter", async ({ page }) => {
      let calls = 0;
      await mockApi(page, {
        ...common,
        "GET /analytics": () => {
          calls += 1;
          // The app's query client retries a 5xx twice before giving up (providers.tsx),
          // so the first three calls fail and the user's Retry is the fourth.
          return calls <= 3
            ? { status: 500, body: { statusCode: 500, message: "boom" } }
            : { status: 200, body: BY_RANGE["30d"] };
        },
      });
      await page.goto(`/links/${LINK_ID}`);

      const clicks = tile(page, "Total clicks");
      await expect(page.getByRole("alert").filter({ hasText: /Couldn.t load the numbers for this range/ })).toBeVisible();
      await expect(clicks.locator(".font-display")).toHaveText("—");
      await expect(clicks).toContainText("21,504 all-time");

      await page.getByRole("button", { name: "Retry" }).click();
      await expect(clicks.locator(".font-display")).toHaveText("9,207");
      await expect(page.getByRole("alert").filter({ hasText: /Couldn.t load the numbers/ })).toHaveCount(0);
    });

    test("deleting still names the link's all-time clicks, labelled as recorded clicks", async ({ page }) => {
      await mockApi(page, { ...common, "GET /analytics": { status: 200, body: BY_RANGE["30d"] } });
      await page.goto(`/links/${LINK_ID}`);
      await page.locator("main").getByRole("button", { name: "Delete this link" }).click();
      await expect(page.getByText("Its 21,504 recorded clicks go with it.")).toBeVisible();
    });
  });
}
