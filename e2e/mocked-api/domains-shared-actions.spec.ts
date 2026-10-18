import { devices, expect, test, type Page } from "@playwright/test";
import { MOCK_USER, mockApi, seedMockSession } from "../support/mock-api";

/* E2E (#782): Domains page, shared SnapURL domain.

   Before: the shared domain's row offered "Disconnect", ran the whole confirm
   flow, then the API refused with 409 ("That's a shared SnapURL domain — it
   isn't yours to disconnect") — and its SSL cell said "Pending" next to Status
   "Live". Now: no Disconnect on that row (a visible reason instead), and the SSL
   cell is derived from the real ssl state, so it agrees with Status.

   The bodies below are what GET /domains sends (domains.service.ts toDto): the
   system row is live + ssl "active" + no sslRenewsAt + shared:true.

   Viewports: desktop plus both phones; CI installs chromium only, so the
   iPhone runs on chromium with the device's viewport/touch/UA (WebKit is
   exercised locally as evidence). */

const SHARED = { id: "dom_shared", domain: "snap.to", status: "live", ssl: "active", sslRenewsAt: null, links: 3, rootRedirect: null, notFoundRedirect: null, shared: true, dns: null } as const;
const OWN = { id: "dom_own", domain: "go.acme.test", status: "live", ssl: "active", sslRenewsAt: "2027-01-05T00:00:00.000Z", links: 1, rootRedirect: null, notFoundRedirect: null, dns: null } as const;
const OWN_NO_DATE = { id: "dom_nodate", domain: "fresh.acme.test", status: "live", ssl: "active", sslRenewsAt: null, links: 0, rootRedirect: null, notFoundRedirect: null, dns: null } as const;
const PENDING = { id: "dom_pending", domain: "later.acme.test", status: "verifying", ssl: "pending", sslRenewsAt: null, links: 0, rootRedirect: null, notFoundRedirect: null, dns: { type: "TXT", name: "_snapurl.later.acme.test", value: "tok", ttl: 300 } } as const;
const FAILED = { id: "dom_failed", domain: "broken.acme.test", status: "failed", ssl: "failed", sslRenewsAt: null, links: 0, rootRedirect: null, notFoundRedirect: null, dns: null } as const;

async function open(page: Page) {
  await seedMockSession(page);
  const api = await mockApi(page, {
    "GET /auth/me": { status: 200, body: { ...MOCK_USER, role: "owner" } },
    "GET /domains": { status: 200, body: [OWN, OWN_NO_DATE, PENDING, FAILED, SHARED] },
    "DELETE /domains/dom_own": { status: 204 },
    "GET /links": { status: 200, body: { items: [], total: 0, nextCursor: null } },
    "GET /bio-pages": { status: 200, body: [] },
    "GET /members": { status: 200, body: [] },
  });
  await page.goto("/domains");
  await expect(page.getByRole("heading", { name: "Domains" })).toBeVisible();
  return api;
}

const row = (page: Page, domain: string) => page.getByRole("row").filter({ hasText: domain });

const VIEWPORTS = [
  { name: "desktop", use: { viewport: { width: 1440, height: 900 } } },
  { name: "iPhone 15 (393px)", use: { viewport: { width: 393, height: 852 }, isMobile: true, hasTouch: true, userAgent: devices["iPhone 15"].userAgent } },
  { name: "Pixel 7", use: { viewport: devices["Pixel 7"].viewport, isMobile: true, hasTouch: true, userAgent: devices["Pixel 7"].userAgent } },
] as const;

for (const vp of VIEWPORTS) {
  test.describe(`Domains > shared domain (#782) — ${vp.name}`, () => {
    test.use(vp.use);

    test("the shared domain row has no Disconnect, and says why", async ({ page }) => {
      await open(page);
      const shared = row(page, "snap.to");
      await expect(shared).toBeVisible();
      await expect(shared.getByRole("button", { name: /disconnect/i })).toHaveCount(0);
      await expect(shared.getByText("Can't be disconnected")).toBeVisible();
    });

    test("the shared domain's SSL agrees with its Live status (not 'Pending')", async ({ page }) => {
      await open(page);
      const shared = row(page, "snap.to");
      await expect(shared.getByText("Live", { exact: true })).toBeVisible();
      await expect(shared.getByText("Managed by SnapURL")).toBeVisible();
      await expect(shared.getByText("Pending")).toHaveCount(0);
    });

    test("custom domains: SSL is derived from the real state", async ({ page }) => {
      await open(page);
      await expect(row(page, "go.acme.test").getByText(/^Auto · renews /)).toBeVisible();
      // active but no renewal date yet: Active, never Pending next to Live
      await expect(row(page, "fresh.acme.test").getByText("Active", { exact: true })).toBeVisible();
      await expect(row(page, "fresh.acme.test").getByText("Pending")).toHaveCount(0);
      await expect(row(page, "later.acme.test").getByText("Pending", { exact: true })).toBeVisible();
      await expect(row(page, "later.acme.test").getByText("Verifying DNS")).toBeVisible();
      // failed is not mislabelled as verifying / pending
      await expect(row(page, "broken.acme.test").getByText("Failed")).toHaveCount(2);
      await expect(row(page, "broken.acme.test").getByText("Verifying DNS")).toHaveCount(0);
      await expect(row(page, "broken.acme.test").getByText("Pending")).toHaveCount(0);
    });

    test("a custom domain can still be disconnected: confirm, then the DELETE is sent", async ({ page }) => {
      const api = await open(page);
      const own = row(page, "go.acme.test");
      await own.getByRole("button", { name: "Disconnect" }).click();
      await expect(page.getByText("Disconnecting a domain stops every link on it.")).toBeVisible();
      // Keep backs out with no request
      await own.getByRole("button", { name: "Keep" }).click();
      expect(api.callsTo("DELETE", "/domains/dom_own")).toHaveLength(0);
      await own.getByRole("button", { name: "Disconnect" }).click();
      await own.getByRole("button", { name: "Disconnect" }).click();
      await expect.poll(() => api.callsTo("DELETE", "/domains/dom_own").length).toBe(1);
    });

    test("no request is ever sent to disconnect the shared domain", async ({ page }) => {
      const api = await open(page);
      await row(page, "snap.to").click();
      expect(api.callsTo("DELETE", "/domains/dom_shared")).toHaveLength(0);
    });
  });
}
