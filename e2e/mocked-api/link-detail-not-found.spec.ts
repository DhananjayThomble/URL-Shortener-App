import { devices, expect, test } from "@playwright/test";
import { MOCK_USER, MOCK_WORKSPACE, mockApi, nestError, seedMockSession } from "../support/mock-api";

/* #790 — a link detail page for a link that is not there (including one in
   ANOTHER workspace, which the API reports identically so nothing leaks) showed
   the generic "That didn't load" state with only "Try again". Retrying a 404
   repeats the same answer, and there was no way back.

   Oracle: the issue's acceptance criteria — a 404 on link detail renders a
   not-found state with "Back to links", not a retry. The 404 body is the one
   LinksService.get really sends (apps/api/src/links/links.service.ts, "That link
   doesn't exist, or isn't in this workspace."); the 400 is what ParseUUIDPipe
   sends for a malformed id (links.controller.ts GET :id).

   Real API client + React Query cache: the "no retry loop" assertion counts the
   requests the app actually makes. */

const MISSING_ID = "0191f6a0-0000-7000-8000-000000000790";
const SERVER_MESSAGE = "That link doesn't exist, or isn't in this workspace.";

const common = {
  "GET /auth/me": { status: 200, body: MOCK_USER },
  "GET /auth/workspaces": { status: 200, body: [] },
  "GET /workspaces/current": { status: 200, body: MOCK_WORKSPACE },
  "GET /links": { status: 200, body: { items: [], total: 0, nextCursor: null } },
  "GET /domains": { status: 200, body: [] },
} as const;

const analyticsEmpty = {
  status: 200,
  body: {
    totals: { clicks: 0, unique: 0, scans: 0, conversions: 0, blocked: 0 },
    deltas: { clicks: null, unique: null, scans: null, conversions: null },
    series: [],
    countries: [],
    cities: [],
    devices: [],
    browsers: [],
    referrers: [],
    tags: [],
    topLinks: [],
  },
} as const;

for (const [name, use] of [
  ["desktop", { viewport: { width: 1440, height: 900 } }],
  // defaultBrowserType forces a new worker and cannot be set inside a describe.
  ["mobile", (({ defaultBrowserType: _ignored, ...rest }) => rest)(devices["Pixel 7"])],
] as const) {
  test.describe(`link detail not-found (#790) — ${name}`, () => {
    test.use(use);

    test.beforeEach(async ({ page }) => {
      await seedMockSession(page);
    });

    test("a 404 shows a not-found state with Back to links, not a retry, and does not loop", async ({ page }) => {
      const api = await mockApi(page, {
        ...common,
        [`GET /links/${MISSING_ID}`]: nestError(404, SERVER_MESSAGE, "Not Found"),
        "GET /analytics": analyticsEmpty,
      });
      await page.goto(`/links/${MISSING_ID}`);

      const main = page.locator("main");
      await expect(main.getByRole("heading", { name: "Link not found" })).toBeVisible();
      // The way out is a real link back to the list.
      const back = main.getByRole("link", { name: "Back to links" });
      await expect(back).toBeVisible();
      await expect(back).toHaveAttribute("href", "/links");
      // Retrying a 404 can only repeat it, so there is no retry and no generic failure copy.
      await expect(main.getByRole("button", { name: "Try again" })).toHaveCount(0);
      await expect(main.getByText("That didn't load")).toHaveCount(0);
      // The same copy whether the link is absent or in another workspace: the server's
      // wording is not echoed back, so the page cannot tell the two apart.
      await expect(main.getByText(SERVER_MESSAGE)).toHaveCount(0);
      await expect(main.getByText(/another workspace/i)).toHaveCount(0);

      // No retry loop: give a would-be retry time to fire, then count requests.
      await page.waitForTimeout(1500);
      expect(api.callsTo("GET", `/links/${MISSING_ID}`)).toHaveLength(1);

      // Clicking it actually leaves for the list.
      await back.click();
      await expect(page).toHaveURL(/\/links$/);
    });

    test("a malformed id (400) reads as not found too, without the raw validation text", async ({ page }) => {
      await mockApi(page, {
        ...common,
        "GET /links/not-a-uuid": nestError(400, "Validation failed (uuid is expected)", "Bad Request"),
        "GET /analytics": analyticsEmpty,
      });
      await page.goto("/links/not-a-uuid");
      const main = page.locator("main");
      await expect(main.getByRole("heading", { name: "Link not found" })).toBeVisible();
      await expect(main.getByRole("link", { name: "Back to links" })).toHaveAttribute("href", "/links");
      await expect(main.getByText(/uuid|validation/i)).toHaveCount(0);
    });

    test("a 403 is not retryable either, and still offers the way back", async ({ page }) => {
      await mockApi(page, {
        ...common,
        [`GET /links/${MISSING_ID}`]: nestError(403, "Forbidden resource", "Forbidden"),
        "GET /analytics": analyticsEmpty,
      });
      await page.goto(`/links/${MISSING_ID}`);
      const main = page.locator("main");
      await expect(main.getByRole("link", { name: "Back to links" })).toBeVisible();
      await expect(main.getByRole("button", { name: "Try again" })).toHaveCount(0);
    });

    test("a server error is still retryable, and Try again recovers", async ({ page }) => {
      let calls = 0;
      await mockApi(page, {
        ...common,
        "GET /analytics": analyticsEmpty,
        [`GET /links/${MISSING_ID}`]: () => {
          calls += 1;
          // The app's query client retries a 5xx twice before giving up (providers.tsx),
          // so the first three calls fail and the user's Try again is the fourth.
          return calls <= 3
            ? nestError(500, "boom", "Internal Server Error")
            : {
                status: 200,
                body: {
                  id: MISSING_ID,
                  domain: "snap.to",
                  slug: "back-again",
                  destination: "https://example.com/",
                  status: "active",
                  clicks: 0,
                  uniqueClicks: 0,
                  redirectType: "302",
                  rules: [],
                  tags: [],
                  safeBrowsing: { status: "clean", checkedAt: "2026-10-01T00:00:00.000Z" },
                  sparkline: [],
                  createdAt: "2026-07-01T00:00:00.000Z",
                },
              };
        },
      });
      await page.goto(`/links/${MISSING_ID}`);
      const main = page.locator("main");
      await expect(main.getByRole("button", { name: "Try again" })).toBeVisible();
      await expect(main.getByRole("heading", { name: "Link not found" })).toHaveCount(0);
      await main.getByRole("button", { name: "Try again" }).click();
      await expect(main.getByText("back-again")).toBeVisible();
    });
  });
}
