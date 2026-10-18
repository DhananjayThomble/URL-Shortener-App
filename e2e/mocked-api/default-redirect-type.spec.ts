import { devices, expect, test, type Page } from "@playwright/test";
import { fakeAccessToken, MOCK_USER, MOCK_WORKSPACE, mockApi, seedMockSession, type MockRequest } from "../support/mock-api";

/* #753 — the workspace's "Default redirect type" setting ("Applies to new
   links") was ignored by the web app: the New link drawer always preselected
   302 and Bulk create sent "302" on every row, so even a fixed API could not
   apply the workspace default.

   Runs in the mocked-api lane because what is asserted is the REAL request body
   the real API client sends (fixtures mode bypasses it). The mock answers
   POST /links and /links/bulk the way the API does after #753 — an omitted
   redirectType gets the workspace default (links.service.ts defaultRedirectFor)
   — or, for the deploy-skew case, the way the API did BEFORE #753 (omitted ->
   302), which this web build must still handle without crashing. */

type Ws = { defaultRedirect: "301" | "302" | "307" };

const DOMAIN = {
  id: "dom_snap",
  domain: "snap.to",
  status: "live",
  ssl: "active",
  sslRenewsAt: null,
  links: 0,
  rootRedirect: null,
  notFoundRedirect: null,
  shared: true,
  dns: null,
} as const;

function linkFrom(row: Record<string, unknown>, redirectType: string, n: number) {
  return {
    id: `lnk_${n}`,
    domain: String(row.domain),
    slug: String(row.slug || `gen${n}`),
    destination: String(row.destination),
    title: null,
    comment: null,
    tags: [],
    folder: null,
    status: "active",
    clicks: 0,
    uniqueClicks: 0,
    redirectType,
    rules: [],
    passwordProtected: false,
    forwardQuery: true,
    deepLink: false,
    hideReferrer: false,
    publicPreview: true,
    cloaked: false,
    safeBrowsing: { status: "clean", checkedAt: "2026-01-01T00:00:00.000Z" },
    sparkline: [],
    createdAt: "2026-01-01T00:00:00.000Z",
    createdBy: MOCK_USER.name,
  };
}

/** `apiFallback` is what the mock API stores for an omitted redirectType:
 *  the workspace default (new API) or "302" (an API from before #753). */
async function signedIn(page: Page, ws: Ws, apiFallback: string = ws.defaultRedirect) {
  let n = 0;
  const api = await mockApi(page, {
    "GET /auth/me": { status: 200, body: MOCK_USER },
    "GET /workspaces/current": { status: 200, body: { ...MOCK_WORKSPACE, ...ws } },
    "GET /auth/workspaces": {
      status: 200,
      body: [{ id: MOCK_WORKSPACE.id, name: MOCK_WORKSPACE.name, initials: MOCK_WORKSPACE.initials, role: "owner", current: true }],
    },
    "GET /domains": { status: 200, body: [DOMAIN] },
    "GET /links": { status: 200, body: { items: [], total: 0, nextCursor: null } },
    "GET /members": { status: 200, body: [] },
    "POST /links": (req: MockRequest) => {
      const row = req.body as Record<string, unknown>;
      return { status: 201, body: linkFrom(row, (row.redirectType as string) ?? apiFallback, ++n) };
    },
    "POST /links/bulk": (req: MockRequest) => {
      const rows = (req.body as { links: Record<string, unknown>[] }).links;
      const results = rows.map((row, index) => ({
        ok: true,
        index,
        link: linkFrom(row, (row.redirectType as string) ?? apiFallback, ++n),
      }));
      return { status: 200, body: { created: rows.length, skipped: 0, failed: 0, results } };
    },
  });
  await seedMockSession(page, fakeAccessToken(MOCK_WORKSPACE.id));
  return api;
}

async function openDrawerRouting(page: Page) {
  await page.goto("/links?new=https%3A%2F%2Fexample.com%2Fspring");
  const drawer = page.getByRole("dialog", { name: "Create a link" });
  await expect(drawer).toBeVisible();
  await drawer.getByRole("tab", { name: "Routing" }).click();
  return drawer;
}

const pressed = (drawer: ReturnType<Page["getByRole"]>, t: string) =>
  drawer.getByRole("group", { name: "Redirect type" }).getByRole("button", { name: t, exact: true });

/* Pixel 7 is a chromium device, same engine as this lane's only project; its
   defaultBrowserType cannot be set per describe, so it is dropped. iPhone 15
   (webkit) is covered on the real stack by the journeys lane. */
const { defaultBrowserType: _engine, ...PIXEL_7 } = devices["Pixel 7"];

for (const [label, use] of [
  ["desktop", {}],
  ["mobile (Pixel 7)", PIXEL_7],
] as const) {
  test.describe(`workspace default redirect type is applied to new links (#753) — ${label}`, () => {
    test.use(use);

    for (const def of ["301", "302", "307"] as const) {
      test(`New link drawer preselects the workspace default ${def} and sends it`, async ({ page }) => {
        const api = await signedIn(page, { defaultRedirect: def });
        const drawer = await openDrawerRouting(page);
        await expect(pressed(drawer, def)).toHaveAttribute("aria-pressed", "true");
        for (const other of ["301", "302", "307"].filter((t) => t !== def)) {
          await expect(pressed(drawer, other)).toHaveAttribute("aria-pressed", "false");
        }
        await drawer.getByRole("button", { name: "Create link" }).click();
        await expect(drawer).toBeHidden();
        const [call] = api.callsTo("POST", "/links");
        expect((call!.body as { redirectType?: string }).redirectType).toBe(def);
      });
    }

    test("an explicit choice in the drawer still wins over the workspace default", async ({ page }) => {
      const api = await signedIn(page, { defaultRedirect: "301" });
      const drawer = await openDrawerRouting(page);
      await expect(pressed(drawer, "301")).toHaveAttribute("aria-pressed", "true");
      await pressed(drawer, "307").click();
      await expect(pressed(drawer, "307")).toHaveAttribute("aria-pressed", "true");
      await drawer.getByRole("button", { name: "Create link" }).click();
      await expect(drawer).toBeHidden();
      expect((api.callsTo("POST", "/links")[0]!.body as { redirectType?: string }).redirectType).toBe("307");
    });

    test("reopening the drawer after a different choice starts on the workspace default again", async ({ page }) => {
      await signedIn(page, { defaultRedirect: "301" });
      let drawer = await openDrawerRouting(page);
      await pressed(drawer, "302").click();
      await drawer.getByRole("button", { name: "Cancel" }).click();
      await expect(drawer).toBeHidden();
      // Desktop has the sidebar button; at phone width it lives in the nav sheet.
      const menu = page.getByRole("button", { name: "Open navigation menu" });
      if (await menu.isVisible()) await menu.click();
      await page.getByRole("button", { name: /New link/ }).filter({ visible: true }).first().click();
      drawer = page.getByRole("dialog", { name: "Create a link" });
      await drawer.getByRole("tab", { name: "Routing" }).click();
      await expect(pressed(drawer, "301")).toHaveAttribute("aria-pressed", "true");
    });

    test("Bulk create does not send a redirect type, so every row gets the workspace default", async ({ page }) => {
      const api = await signedIn(page, { defaultRedirect: "301" });
      await page.goto("/links");
      await page.getByRole("button", { name: "Bulk create" }).click();
      await page.getByLabel("One link per line").fill("https://example.com/a\nhttps://example.com/b, b-sale");
      await page.getByRole("button", { name: "Create 2 links" }).click();
      await expect(page.getByText("2 created.")).toBeVisible();
      const [call] = api.callsTo("POST", "/links/bulk");
      const rows = (call!.body as { links: Record<string, unknown>[] }).links;
      expect(rows).toHaveLength(2);
      for (const row of rows) expect(row).not.toHaveProperty("redirectType");
    });

    test("Import links sends no redirect type, so imported links get the workspace default too", async ({ page }) => {
      const api = await signedIn(page, { defaultRedirect: "301" });
      // The panel opens from the ?import= deep link (links/page.tsx
      // ImportDeepLink). generic-csv matches the documented long_url,back_half,title shape.
      await page.goto("/links?import=generic-csv");
      await expect(page.getByLabel("Export contents")).toBeVisible();
      await page.getByLabel("Export contents").fill("long_url,back_half,title\nhttps://acme.com/spring,,Spring\nhttps://acme.com/summer,,Summer");
      await page.getByRole("button", { name: /^Import 2 links/ }).click();
      await expect(page.getByText("2 imported.")).toBeVisible();
      const [call] = api.callsTo("POST", "/links/bulk");
      const rows = (call!.body as { links: Record<string, unknown>[] }).links;
      expect(rows).toHaveLength(2);
      for (const row of rows) expect(row).not.toHaveProperty("redirectType");
    });
  });
}

test.describe("deploy skew: this web build against an API from before #753 (#753)", () => {
  test("drawer still sends the preselected type explicitly, so an old API stores the workspace default too", async ({ page }) => {
    const api = await signedIn(page, { defaultRedirect: "301" }, "302");
    const drawer = await openDrawerRouting(page);
    await drawer.getByRole("button", { name: "Create link" }).click();
    await expect(drawer).toBeHidden();
    expect((api.callsTo("POST", "/links")[0]!.body as { redirectType?: string }).redirectType).toBe("301");
  });

  test("bulk create against an old API that still defaults to 302 completes without an error", async ({ page }) => {
    await signedIn(page, { defaultRedirect: "301" }, "302");
    await page.goto("/links");
    await page.getByRole("button", { name: "Bulk create" }).click();
    await page.getByLabel("One link per line").fill("https://example.com/old-api");
    await page.getByRole("button", { name: "Create 1 link" }).click();
    await expect(page.getByText("1 created.")).toBeVisible();
    // The bulk panel's own error line (bulk-create-panel.tsx) — not Next's route announcer.
    await expect(page.locator("p[role='alert']")).toHaveCount(0);
  });
});
