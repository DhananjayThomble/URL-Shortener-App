import { devices, expect, test, type Page } from "@playwright/test";
import { MOCK_USER, MOCK_WORKSPACE, fakeAccessToken, mockApi, seedMockSession, type MockApi } from "../support/mock-api";

/* #771 — the sidebar's "Clicks this month" showed 0 while the Links list showed
   1 (later 2) until a full reload. The count is Workspace.clicksUsed from
   GET /workspaces/current (packages/contract/src/workspace.ts), which the
   always-mounted sidebar read with a 5-minute staleTime, no refetch interval
   and refetchOnWindowFocus off app-wide, so nothing ever re-requested it.

   This lane uses the REAL API client + React Query cache. A fake clock drives
   the timers, so a 30 s / 60 s cadence is asserted without sleeping. What is
   asserted is the observable effect: the number in the sidebar (desktop) or the
   open navigation drawer (mobile), and how many GET /workspaces/current
   requests the browser made (no hammering). */

const PATH = "/workspaces/current";
const INTERVAL_MS = 60_000;
const STALE_MS = 30_000;

async function install(page: Page, state: { clicks: number }): Promise<MockApi> {
  await seedMockSession(page, fakeAccessToken(MOCK_WORKSPACE.id));
  return mockApi(page, {
    "GET /auth/me": { status: 200, body: MOCK_USER },
    "GET /auth/workspaces": { status: 200, body: [] },
    "GET /workspaces/current": () => ({ status: 200, body: { ...MOCK_WORKSPACE, clicksUsed: state.clicks } }),
    "GET /links": { status: 200, body: { items: [], total: 0, nextCursor: null } },
    "GET /bio-pages": { status: 200, body: [] },
    "GET /domains": { status: 200, body: [] },
    "GET /members": { status: 200, body: [] },
  });
}

/** The visible "Clicks this month" value: the sidebar on desktop, the drawer on mobile. */
async function clicksShown(page: Page): Promise<string | null> {
  const hamburger = page.getByRole("button", { name: "Open navigation menu" });
  if (await hamburger.isVisible()) {
    await hamburger.click();
    const drawer = page.getByRole("dialog", { name: "Navigation" });
    const text = await drawer.getByText("Clicks this month").locator("xpath=..").locator("b").textContent();
    await page.keyboard.press("Escape");
    await expect(drawer).toBeHidden();
    return text;
  }
  return page.getByRole("complementary").getByText("Clicks this month").locator("xpath=..").locator("b").textContent();
}

const settled = (page: Page) => page.waitForLoadState("networkidle");

/** What the browser does when the tab becomes visible again: a bubbling visibilitychange. */
const refocus = (page: Page) =>
  page.evaluate(() => document.dispatchEvent(new Event("visibilitychange", { bubbles: true })));

/* On mobile, reading the count opens the drawer, and mounting a second reader would
   itself refetch a stale value. So every refresh test first waits for the request
   COUNT to move — proving the sidebar's own query fetched — and only then reads. */
const requests = (api: MockApi) => () => api.callsTo("GET", PATH).length;

for (const [name, use] of [
  ["desktop", { viewport: { width: 1440, height: 900 } }],
  // defaultBrowserType forces a new worker and cannot be set inside a describe.
  ["mobile", (({ defaultBrowserType: _ignored, ...rest }) => rest)(devices["Pixel 7"])],
] as const) {
  test.describe(`sidebar clicks this month stays current (#771) — ${name}`, () => {
    test.use(use);

    test("catches up on its own after the interval, without a reload", async ({ page }) => {
      const state = { clicks: 0 };
      await page.clock.install();
      const api = await install(page, state);
      await page.goto("/links");
      await settled(page);
      expect(await clicksShown(page)).toBe("0");

      const first = api.callsTo("GET", PATH).length;
      state.clicks = 1; // a rollup landed server-side
      await page.clock.runFor(INTERVAL_MS + 1_000);
      await expect.poll(requests(api)).toBe(first + 1);
      await expect.poll(() => clicksShown(page)).toBe("1");

      state.clicks = 2;
      await page.clock.runFor(INTERVAL_MS + 1_000);
      await expect.poll(requests(api)).toBe(first + 2);
      await expect.poll(() => clicksShown(page)).toBe("2");
    });

    test("catches up when the tab regains focus once the value is stale", async ({ page }) => {
      const state = { clicks: 0 };
      await page.clock.install();
      const api = await install(page, state);
      await page.goto("/links");
      await settled(page);
      expect(await clicksShown(page)).toBe("0");
      const before = api.callsTo("GET", PATH).length;

      state.clicks = 3;
      // Past staleTime but short of the interval, so only a focus can have fetched.
      await page.clock.runFor(STALE_MS + 5_000);
      await refocus(page);
      await expect.poll(requests(api)).toBe(before + 1);
      await expect.poll(() => clicksShown(page)).toBe("3");
      expect(api.callsTo("GET", PATH).length).toBe(before + 1);
    });

    test("does not hammer the API: focus within the fresh window and idle time make no extra request", async ({ page }) => {
      const state = { clicks: 0 };
      await page.clock.install();
      const api = await install(page, state);
      await page.goto("/links");
      await settled(page);
      const before = api.callsTo("GET", PATH).length;

      for (let i = 0; i < 5; i++) await refocus(page);
      await page.clock.runFor(STALE_MS - 5_000);
      await refocus(page);
      await settled(page);
      expect(api.callsTo("GET", PATH).length).toBe(before);

      // Three idle minutes is exactly one request per interval, not a stream.
      for (let i = 1; i <= 3; i++) {
        await page.clock.runFor(INTERVAL_MS);
        await expect.poll(requests(api)).toBe(before + i);
        await settled(page);
        expect(api.callsTo("GET", PATH).length).toBe(before + i);
      }
    });

    test("a refetch that fails keeps the last known count on screen", async ({ page }) => {
      const state = { clicks: 5 };
      let failing = false;
      await page.clock.install();
      await seedMockSession(page, fakeAccessToken(MOCK_WORKSPACE.id));
      const api = await mockApi(page, {
        "GET /auth/me": { status: 200, body: MOCK_USER },
        "GET /auth/workspaces": { status: 200, body: [] },
        "GET /workspaces/current": () =>
          failing
            ? { status: 500, body: { statusCode: 500, message: "boom" } }
            : { status: 200, body: { ...MOCK_WORKSPACE, clicksUsed: state.clicks } },
        "GET /links": { status: 200, body: { items: [], total: 0, nextCursor: null } },
        "GET /bio-pages": { status: 200, body: [] },
        "GET /domains": { status: 200, body: [] },
        "GET /members": { status: 200, body: [] },
      });
      await page.goto("/links");
      await settled(page);
      expect(await clicksShown(page)).toBe("5");

      const before = api.callsTo("GET", PATH).length;
      failing = true;
      await page.clock.runFor(INTERVAL_MS + 1_000);
      await expect.poll(requests(api)).toBeGreaterThan(before);
      await settled(page);
      expect(await clicksShown(page)).toBe("5");
    });
  });
}
