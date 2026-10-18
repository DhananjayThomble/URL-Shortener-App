import { devices, expect, test, type Page } from "@playwright/test";
import { MOCK_USER, MOCK_WORKSPACE, mockApi, seedMockSession, type MockReply } from "../support/mock-api";

/* E2E (#789): a brand-new workspace has no bio pages, no API keys, no webhooks and
   no conversions. QA saw blank tables, a blank preview, scrollbars over nothing, and
   a funnel whose labels were cut off ("Signu"). Each of those pages must say what is
   missing and offer the way to fix it, using the shared EmptyState.

   Oracles: the shared EmptyState component (web/src/components/ui — heading + body +
   one action) and the wire shapes in packages/contract (BioPage[], ApiKey[], Webhook[],
   ConversionsReport). The server replies are what the NestJS API sends for an empty
   workspace; a request with no handler is answered 599, so a stray call fails loudly.

   Viewports: 1440 and 768 on desktop Chromium, 390 as Pixel 7 (CI installs chromium
   only, so iPhone 15 is local evidence). */

const SHARED = { id: "dom_shared", domain: "snap.to", status: "live", ssl: "active", links: 0, rootRedirect: null, notFoundRedirect: null, shared: true } as const;

const EMPTY_CONVERSIONS = {
  currency: "INR",
  excluded: { count: 0, byCurrency: [] },
  totals: { clicks: 0, leads: 0, signups: 0, paid: 0, revenue: 0 },
  deltas: { clicks: null, leads: null, signups: null, paid: null, revenue: null },
  events: [],
  byLink: [],
  revenueSeries: [],
};

// Clicks, but nothing past them yet — the narrowest funnel bars (8% floor).
const CLICKS_ONLY_CONVERSIONS = {
  ...EMPTY_CONVERSIONS,
  totals: { clicks: 120, leads: 0, signups: 0, paid: 0, revenue: 0 },
};

const common = {
  "GET /auth/me": { status: 200, body: MOCK_USER },
  "GET /auth/workspaces": { status: 200, body: [] },
  "GET /workspaces/current": { status: 200, body: MOCK_WORKSPACE },
  "GET /domains": { status: 200, body: [SHARED] },
  "GET /links": { status: 200, body: { items: [], total: 0, nextCursor: null } },
  "GET /members": { status: 200, body: [] },
} as const;

const VIEWPORTS = [
  { name: "desktop 1440", use: { viewport: { width: 1440, height: 900 } } },
  { name: "tablet 768", use: { viewport: { width: 768, height: 1024 } } },
  // defaultBrowserType forces a new worker and cannot be set inside a describe.
  { name: "mobile 390", use: (({ defaultBrowserType: _ignored, ...rest }) => rest)(devices["Pixel 7"]) },
] as const;

const ok = (body: unknown): MockReply => ({ status: 200, body });

async function noHorizontalOverflow(page: Page) {
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth);
  expect(overflow, "page scrolls sideways").toBe(false);
}

for (const vp of VIEWPORTS) {
  test.describe(`empty states (#789) — ${vp.name}`, () => {
    test.use(vp.use);

    test.beforeEach(async ({ page }) => {
      await seedMockSession(page);
    });

    test("/bio: no pages shows a first-page empty state whose action opens the create form", async ({ page }) => {
      await mockApi(page, { ...common, "GET /bio-pages": ok([]) });
      await page.goto("/bio");

      const empty = page.getByRole("heading", { name: "Create your first bio page" });
      await expect(empty).toBeVisible();
      // No blank table, and no preview that will never fill in.
      await expect(page.getByRole("region", { name: "Your pages" })).toHaveCount(0);
      await expect(page.getByTestId("bio-preview")).toHaveCount(0);
      await expect(page.locator('[class*="animate-pulse"], [aria-busy="true"]')).toHaveCount(0);

      // The action does something observable: the create form opens.
      await expect(page.getByRole("heading", { name: "New bio page" })).toHaveCount(0);
      await page.getByRole("button", { name: "Create your first page" }).click();
      await expect(page.getByRole("heading", { name: "New bio page" })).toBeVisible();
      await expect(page.getByPlaceholder("yourname")).toBeFocused();
      await noHorizontalOverflow(page);
    });

    test("/bio: a failed load is an error with Try again, never 'no pages'", async ({ page }) => {
      await mockApi(page, { ...common, "GET /bio-pages": { status: 500, body: { statusCode: 500, message: "Boom", error: "Internal Server Error" } } });
      await page.goto("/bio");
      await expect(page.getByText("That didn't load")).toBeVisible();
      await expect(page.getByRole("button", { name: "Try again" })).toBeVisible();
      await expect(page.getByRole("heading", { name: "Create your first bio page" })).toHaveCount(0);
    });

    test("/developers: no keys and no webhooks show two empty states, with no empty tables", async ({ page }) => {
      await mockApi(page, { ...common, "GET /api-keys": ok([]), "GET /webhooks": ok([]) });
      await page.goto("/developers");

      await expect(page.getByRole("heading", { name: "No API keys yet" })).toBeVisible();
      await expect(page.getByRole("heading", { name: "No webhooks yet" })).toBeVisible();
      // The empty tables (and their scrollers) are gone.
      await expect(page.getByRole("region", { name: "API keys" })).toHaveCount(0);
      await expect(page.getByRole("region", { name: "Webhooks" })).toHaveCount(0);
      await expect(page.getByRole("columnheader", { name: "Last used" })).toHaveCount(0);
      await expect(page.getByRole("columnheader", { name: "Endpoint" })).toHaveCount(0);

      // Each action opens its own form.
      await page.getByRole("button", { name: "Create an API key" }).click();
      await expect(page.getByRole("heading", { name: "New API key" })).toBeVisible();
      await page.getByRole("button", { name: "Add a webhook endpoint" }).click();
      await expect(page.getByRole("heading", { name: "Add a webhook endpoint" })).toBeVisible();
      await noHorizontalOverflow(page);
    });

    test("/developers: while webhooks load, and when they fail, it never claims there are none", async ({ page }) => {
      await mockApi(page, {
        ...common,
        "GET /api-keys": ok([]),
        "GET /webhooks": { status: 500, body: { statusCode: 500, message: "Boom", error: "Internal Server Error" } },
      });
      await page.goto("/developers");
      await expect(page.getByRole("heading", { name: "No API keys yet" })).toBeVisible();
      await expect(page.getByText("That didn't load")).toBeVisible();
      await expect(page.getByRole("heading", { name: "No webhooks yet" })).toHaveCount(0);
    });

    test("/conversions: a workspace with no data explains each empty panel and says what to do", async ({ page }) => {
      await mockApi(page, { ...common, "GET /conversions": ok(EMPTY_CONVERSIONS) });
      await page.goto("/conversions");

      await expect(page.getByRole("heading", { name: "No clicks in this range" })).toBeVisible();
      await expect(page.getByRole("heading", { name: "No events tracked yet" })).toBeVisible();
      await expect(page.getByRole("heading", { name: "No revenue by link yet" })).toBeVisible();
      // No header-only table.
      await expect(page.getByRole("region", { name: "Revenue by link" })).toHaveCount(0);
      // The primary actions are real links.
      await expect(page.getByRole("link", { name: "Create a link" })).toHaveAttribute("href", "/links");
      await expect(page.getByRole("link", { name: "Read the API docs" })).toHaveAttribute("href", /\/docs$/);
      // One format for every rate: nothing is drawn with two decimals, and nothing is NaN.
      const text = await page.locator("main").innerText();
      expect(text).not.toMatch(/NaN|Infinity/);
      expect(text).not.toMatch(/\d\.\d\d%/);
      await noHorizontalOverflow(page);
    });

    test("/conversions: clicks but no conversions keeps the funnel, and every funnel label is fully visible", async ({ page }) => {
      await mockApi(page, { ...common, "GET /conversions": ok(CLICKS_ONLY_CONVERSIONS) });
      await page.goto("/conversions");

      const funnel = page.getByRole("list", { name: "Conversion funnel" });
      await expect(funnel).toBeVisible();
      const card = await funnel.boundingBox();
      for (const label of ["Clicks", "Leads", "Signups", "Paid"]) {
        const el = funnel.getByText(label, { exact: true });
        await expect(el).toBeVisible();
        const box = (await el.boundingBox())!;
        // Inside the card on every side, not cut off by it.
        expect(box.x).toBeGreaterThanOrEqual(card!.x);
        expect(box.x + box.width).toBeLessThanOrEqual(card!.x + card!.width + 0.5);
        // The text itself is not truncated: its own box is not narrower than its content.
        const clipped = await el.evaluate((n) => n.scrollWidth > n.clientWidth + 1);
        expect(clipped, `${label} is clipped`).toBe(false);
        // And it does not sit on the bar: the bar is as narrow as 8% of the card, so a
        // label drawn over it is light-on-light once the text outgrows the bar.
        const row = el.locator('xpath=ancestor::li[1]');
        const bar = row.locator('[data-funnel-bar]');
        const b = (await bar.boundingBox())!;
        expect(box.y + box.height, `${label} overlaps its bar`).toBeLessThanOrEqual(b.y + 0.5);
      }
      await noHorizontalOverflow(page);
    });

    test("/conversions: the same rate reads the same everywhere (tiles, funnel, table)", async ({ page }) => {
      await mockApi(page, {
        ...common,
        "GET /conversions": ok({
          ...EMPTY_CONVERSIONS,
          totals: { clicks: 10000, leads: 0, signups: 6, paid: 2, revenue: 4000 },
          deltas: { clicks: null, leads: null, signups: null, paid: null, revenue: null },
          events: [{ id: "e1", kind: "sale", name: "Subscription", source: "Stripe webhook", count: 2 }],
          byLink: [{ link: "snap.to/a", campaign: "x", clicks: 10000, signups: 6, cvr: 0.1, revenue: 4000 }],
          revenueSeries: [0, 1],
        }),
      });
      await page.goto("/conversions");
      const main = page.locator("main");
      // 6/10000 = 0.06% and 2/10000 = 0.02%: both below the one-decimal grid.
      await expect(main).toContainText("0.1%");
      await expect(main).not.toContainText(/\d\.\d\d%/);
      await expect(main).not.toContainText("0.0%");
      await expect(main.getByText("<0.1%").first()).toBeVisible();
    });
  });
}
