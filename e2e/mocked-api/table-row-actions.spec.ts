import { devices, expect, test, type Page } from "@playwright/test";
import { MOCK_USER, mockApi, seedMockSession } from "../support/mock-api";
import {
  clickInPlace,
  expectHeaderAlignsWithCells,
  expectNoPageOverflow,
  expectReachable,
  scrollTableEnd,
  scrollTableStart,
} from "../support/row-actions";

/* E2E (#786): row actions must not hide behind horizontal scroll.

   QA saw "Revoke" cut off to "Rev" on /developers at ~1316px (the API-keys card
   is half the content width there) and the Domains actions off-screen at 640px.
   The shared <Table/> has a min-width, so on any viewport narrower than that
   the right-most column — the one holding the row's buttons — is pushed into
   the scroller's overflow.

   Each case measures where the real control is and presses the real pixel
   (support/row-actions.ts: no scrollIntoView, which would mask the bug), at the
   four widths from the issue: 1316, 1024, 640, 390. It asserts the OBSERVABLE
   effect of the click (confirm state, request sent, editor opened), not that
   the button merely rendered.

   Worst-case data: a long key name, three scopes, a long webhook endpoint, and
   a pending custom domain (which carries all three domain actions at once).

   Chromium only (CI installs nothing else); iPhone 15 is run locally as
   evidence. */

const KEYS = [
  { id: "key_long", name: "Production deploy bot for the marketing site", maskedKey: "sk_live_…a1b2", scopes: ["links:read", "links:write", "analytics:read"], lastUsed: "2 hours ago" },
  { id: "key_short", name: "CI", maskedKey: "sk_live_…c3d4", scopes: ["links:read"], lastUsed: null },
];
const HOOKS = [
  { id: "wh_1", endpoint: "https://hooks.example.com/services/T0000000/B0000000/XXXXXXXXXXXXXXXXXXXXXXXX", events: ["link.created", "link.clicked"], health: "healthy", detail: "Healthy" },
];
const OWN = { id: "dom_own", domain: "go.acme.test", status: "live", ssl: "active", sslRenewsAt: "2027-01-05T00:00:00.000Z", links: 1, rootRedirect: "https://acme.test/", notFoundRedirect: "https://acme.test/not-found", dns: null } as const;
const PENDING = { id: "dom_pending", domain: "later.acme.test", status: "verifying", ssl: "pending", sslRenewsAt: null, links: 0, rootRedirect: null, notFoundRedirect: null, dns: { type: "TXT", name: "_snapurl.later.acme.test", value: "tok", ttl: 300 } } as const;
const SHARED = { id: "dom_shared", domain: "snap.to", status: "live", ssl: "active", sslRenewsAt: null, links: 3, rootRedirect: null, notFoundRedirect: null, shared: true, dns: null } as const;

async function open(page: Page, path: "/developers" | "/domains") {
  await seedMockSession(page);
  const api = await mockApi(page, {
    "GET /auth/me": { status: 200, body: { ...MOCK_USER, role: "owner" } },
    "GET /api-keys": { status: 200, body: KEYS },
    "GET /webhooks": { status: 200, body: HOOKS },
    "GET /domains": { status: 200, body: [OWN, PENDING, SHARED] },
    "DELETE /api-keys/key_long": { status: 204 },
    "DELETE /webhooks/wh_1": { status: 204 },
    "DELETE /domains/dom_own": { status: 204 },
    "POST /domains/dom_pending/verify": { status: 200, body: PENDING },
    "GET /links": { status: 200, body: { items: [], total: 0, nextCursor: null } },
    "GET /bio-pages": { status: 200, body: [] },
    "GET /members": { status: 200, body: [] },
  });
  await page.goto(path);
  return api;
}

const WIDTHS = [
  { name: "1316px", use: { viewport: { width: 1316, height: 900 } } },
  { name: "1024px", use: { viewport: { width: 1024, height: 900 } } },
  { name: "640px", use: { viewport: { width: 640, height: 900 }, hasTouch: true } },
  { name: "390px", use: { viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, userAgent: devices["Pixel 7"].userAgent } },
] as const;

const row = (page: Page, text: string) => page.getByRole("row").filter({ hasText: text });

for (const w of WIDTHS) {
  test.describe(`row actions are reachable without scrolling — ${w.name}`, () => {
    test.use(w.use);

    test("Developers > API keys: Revoke is fully visible, then confirm + Revoke now are too, and the DELETE is sent", async ({ page }) => {
      const api = await open(page, "/developers");
      const r = row(page, "Production deploy bot");
      await expect(r).toBeVisible();
      await expectNoPageOverflow(page);

      for (const id of ["Production deploy bot", "CI"]) {
        await expectReachable(row(page, id).getByRole("button", { name: "Revoke" }), `${id}: Revoke`);
      }
      // Still reachable after the table is scrolled all the way right and back.
      await scrollTableEnd(r.getByRole("button", { name: "Revoke" }));
      await expectReachable(r.getByRole("button", { name: "Revoke" }), "Revoke after scrolling right");
      await scrollTableStart(r.getByRole("button", { name: "Revoke" }));

      await clickInPlace(page, r.getByRole("button", { name: "Revoke" }), "Revoke");
      // the confirm state shows BOTH buttons, and both are reachable
      await expectReachable(r.getByRole("button", { name: "Keep" }), "Keep");
      await expectReachable(r.getByRole("button", { name: "Revoke now" }), "Revoke now");
      expect(api.callsTo("DELETE", "/api-keys/key_long")).toHaveLength(0);
      await clickInPlace(page, r.getByRole("button", { name: "Revoke now" }), "Revoke now");
      await expect.poll(() => api.callsTo("DELETE", "/api-keys/key_long").length).toBe(1);
    });

    test("Developers > Webhooks: Delete is fully visible, confirm works, and the DELETE is sent", async ({ page }) => {
      const api = await open(page, "/developers");
      const r = row(page, "hooks.example.com");
      await expect(r).toBeVisible();
      await expectNoPageOverflow(page);
      await expectReachable(r.getByRole("button", { name: "Delete" }), "webhook Delete");
      await clickInPlace(page, r.getByRole("button", { name: "Delete" }), "webhook Delete");
      await expectReachable(r.getByRole("button", { name: "Keep" }), "webhook Keep");
      await expectReachable(r.getByRole("button", { name: "Delete" }), "webhook confirm Delete");
      await clickInPlace(page, r.getByRole("button", { name: "Delete" }), "webhook confirm Delete");
      await expect.poll(() => api.callsTo("DELETE", "/webhooks/wh_1").length).toBe(1);
    });

    test("Domains: every action on every row is fully visible and does its job", async ({ page }) => {
      const api = await open(page, "/domains");
      const own = row(page, "go.acme.test");
      const pending = row(page, "later.acme.test");
      await expect(own).toBeVisible();
      await expectNoPageOverflow(page);

      await expectReachable(own.getByRole("button", { name: /Edit redirects/ }), "own: Edit redirects");
      await expectReachable(own.getByRole("button", { name: "Disconnect" }), "own: Disconnect");
      await expectReachable(pending.getByRole("button", { name: /Edit redirects/ }), "pending: Edit redirects");
      await expectReachable(pending.getByRole("button", { name: "Check DNS" }), "pending: Check DNS");
      await expectReachable(pending.getByRole("button", { name: "Disconnect" }), "pending: Disconnect");
      await expectReachable(row(page, "snap.to").getByText("Can't be disconnected"), "shared: reason text");
      await scrollTableEnd(pending.getByRole("button", { name: "Check DNS" }));
      await expectReachable(pending.getByRole("button", { name: "Check DNS" }), "Check DNS after scrolling right");
      await scrollTableStart(pending.getByRole("button", { name: "Check DNS" }));

      await clickInPlace(page, pending.getByRole("button", { name: "Check DNS" }), "Check DNS");
      await expect.poll(() => api.callsTo("POST", "/domains/dom_pending/verify").length).toBeGreaterThan(0);

      await clickInPlace(page, own.getByRole("button", { name: /Edit redirects/ }), "Edit redirects");
      await expect(page.getByRole("region", { name: "Redirects for go.acme.test" })).toBeVisible();
      await page.getByRole("button", { name: "Cancel", exact: true }).click();

      await clickInPlace(page, own.getByRole("button", { name: "Disconnect" }), "Disconnect");
      await expectReachable(own.getByRole("button", { name: "Keep" }), "Keep");
      await expectReachable(own.getByRole("button", { name: "Disconnect" }), "confirm Disconnect");
      await clickInPlace(page, own.getByRole("button", { name: "Disconnect" }), "confirm Disconnect");
      await expect.poll(() => api.callsTo("DELETE", "/domains/dom_own").length).toBe(1);
    });

    test("the actions header sits over its cells", async ({ page }) => {
      await open(page, "/domains");
      const own = row(page, "go.acme.test");
      await expect(own).toBeVisible();
      const table = page.getByRole("table").filter({ has: page.getByRole("columnheader", { name: "Root redirect" }) });
      await expectHeaderAlignsWithCells(
        table.getByRole("columnheader", { name: "Actions" }),
        own.getByRole("cell").last(),
        "Domains actions column",
      );
    });
  });
}
