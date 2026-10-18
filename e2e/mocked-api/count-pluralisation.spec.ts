import { devices, expect, test, type Page } from "@playwright/test";
import { MOCK_USER, MOCK_WORKSPACE, mockApi, seedMockSession } from "../support/mock-api";

/* E2E (#793): counts read "1 link", "1 domain", "1 rule", "1 member" — never
   "1 links across 1 domains" — and a pending invite is not counted as a member.

   Oracle: the issue's acceptance criteria. Member counts exclude pending
   invites ("1 member · 1 pending"); the "N domains" figure counts live domains
   and domains that hold links, not one that is still waiting on DNS.

   Real API client against browser-level answers (shapes: packages/contract/src/
   {workspace,link}.ts). The CI lane installs chromium only, so both phones run
   as chromium with the device's viewport, touch and UA; iPhone 15 on WebKit is
   local evidence. QA_SHOTS_DIR, when set, receives viewport-only screenshots. */

const LINK_ID = "0191f6a0-0000-7000-8000-000000000793";
const LINK = {
  id: LINK_ID,
  domain: "snap.to",
  slug: "one-link",
  destination: "https://example.com/one",
  status: "active",
  clicks: 1,
  uniqueClicks: 1,
  redirectType: "302",
  rules: [{ id: "r1", when: { country: "IN", device: null, language: null }, then: "https://example.com/in", weight: null }],
  tags: [],
  safeBrowsing: { status: "clean", checkedAt: "2026-10-01T00:00:00.000Z" },
  sparkline: [],
  createdAt: "2026-07-01T00:00:00.000Z",
};

const domain = (id: string, name: string, status: "live" | "verifying" | "failed", links: number) => ({
  id,
  domain: name,
  status,
  ssl: status === "live" ? "active" : "pending",
  links,
  rootRedirect: null,
  notFoundRedirect: null,
});

const member = (id: string, name: string, status: "active" | "invited") => ({
  id,
  name,
  email: `${name.toLowerCase()}@mock.test`,
  role: id === "m1" ? "owner" : "editor",
  status,
  links: 0,
  lastActive: status === "active" ? "2026-10-17T08:00:00.000Z" : null,
  invitedAt: status === "invited" ? "2026-10-17T08:00:00.000Z" : null,
  twoFactor: false,
  initials: name.slice(0, 2).toUpperCase(),
});

const blank = { countries: [], cities: [], devices: [], browsers: [], referrers: [], tags: [], topLinks: [] };
const ANALYTICS = {
  totals: { clicks: 1, unique: 1, scans: 0, conversions: 0, blocked: 0 },
  deltas: { clicks: null, unique: null, scans: null, conversions: null },
  series: [{ date: "2026-10-17", clicks: 1, unique: 1, scans: 0 }],
  ...blank,
};

async function open(page: Page, path: string, data: { members: unknown[]; domains: unknown[]; links?: unknown[] }) {
  await seedMockSession(page);
  const links = data.links ?? [LINK];
  await mockApi(page, {
    "GET /auth/me": { status: 200, body: MOCK_USER },
    "GET /auth/workspaces": { status: 200, body: [] },
    "GET /workspaces/current": { status: 200, body: MOCK_WORKSPACE },
    "GET /links": { status: 200, body: { items: links, total: links.length, nextCursor: null } },
    [`GET /links/${LINK_ID}`]: { status: 200, body: LINK },
    "GET /bio-pages": { status: 200, body: [] },
    "GET /domains": { status: 200, body: data.domains },
    "GET /members": { status: 200, body: data.members },
    "GET /analytics": { status: 200, body: ANALYTICS },
    "GET /audit": { status: 200, body: { items: [], nextCursor: null } },
  });
  await page.goto(path);
}

async function shot(page: Page, name: string) {
  const dir = process.env.QA_SHOTS_DIR;
  if (dir) await page.screenshot({ path: `${dir}/${name}.png`, fullPage: false });
}

const VIEWPORTS = [
  { name: "desktop", use: { viewport: { width: 1440, height: 900 } } },
  { name: "iPhone 15 (393px)", use: { viewport: { width: 393, height: 852 }, isMobile: true, hasTouch: true, userAgent: devices["iPhone 15"].userAgent } },
  { name: "Pixel 7", use: { viewport: devices["Pixel 7"].viewport, isMobile: true, hasTouch: true, userAgent: devices["Pixel 7"].userAgent } },
] as const;

for (const vp of VIEWPORTS) {
  test.describe(`count pluralisation (#793) — ${vp.name}`, () => {
    test.use(vp.use);
    const tag = vp.name.split(" ")[0]!.toLowerCase();

    test("/team: one member and one pending invite reads '1 member · 1 pending', and the sidebar says 1", async ({ page }) => {
      await open(page, "/team", {
        members: [member("m1", "Owner", "active"), member("m2", "Maya", "invited")],
        domains: [domain("d1", "snap.to", "live", 1)],
      });
      await expect(page.getByText("1 member · 1 pending", { exact: false })).toBeVisible();
      await expect(page.getByText("2 members")).toHaveCount(0);
      await expect(page.getByText("1 members")).toHaveCount(0);
      await shot(page, `team-${tag}`);

      // The sidebar badge (desktop sidebar or the mobile drawer) counts members, not invites.
      if (vp.name === "desktop") {
        await expect(page.getByRole("link", { name: /^Team\s*1$/ })).toBeVisible();
      }
    });

    test("/team: with nobody pending there is no '· 0 pending'", async ({ page }) => {
      await open(page, "/team", {
        members: [member("m1", "Owner", "active"), member("m3", "Priya", "active")],
        domains: [domain("d1", "snap.to", "live", 1)],
      });
      await expect(page.getByText("2 members", { exact: false })).toBeVisible();
      await expect(page.getByText("pending", { exact: false }).first()).not.toBeVisible();
    });

    test("/links: '1 link across 1 domain' — a domain still verifying with no links is not counted", async ({ page }) => {
      await open(page, "/links", {
        members: [member("m1", "Owner", "active")],
        domains: [domain("d1", "snap.to", "live", 1), domain("d2", "later.acme.test", "verifying", 0)],
      });
      await expect(page.getByText("1 link across 1 domain ·", { exact: false })).toBeVisible();
      await expect(page.getByText("1 links")).toHaveCount(0);
      await expect(page.getByText("2 domains")).toHaveCount(0);
      await shot(page, `links-${tag}`);
    });

    test("/links: a failed domain that holds links still counts; plurals return for 2", async ({ page }) => {
      await open(page, "/links", {
        members: [member("m1", "Owner", "active")],
        domains: [domain("d1", "snap.to", "live", 1), domain("d2", "broken.acme.test", "failed", 3)],
      });
      await expect(page.getByText("1 link across 2 domains ·", { exact: false })).toBeVisible();
    });

    test("/links/:id: '1 rule'", async ({ page }) => {
      await open(page, `/links/${LINK_ID}`, {
        members: [member("m1", "Owner", "active")],
        domains: [domain("d1", "snap.to", "live", 1)],
      });
      await expect(page.getByText("1 rule", { exact: true })).toBeVisible();
      await expect(page.getByText("1 rules")).toHaveCount(0);
      await shot(page, `link-detail-${tag}`);
    });
  });
}
