import { devices, expect, test, type Page } from "@playwright/test";
import { MOCK_USER, mockApi, seedMockSession } from "../support/mock-api";

/* E2E (#784): Domains page, DNS setup instructions.

   Before: after adding a domain the setup card listed ONE record — the TXT
   ownership proof — in a table whose value looked like a link and could not be
   copied. Nothing said where to point traffic, so a customer who did exactly
   what it said had a verified domain that served nothing.

   Now: two labelled steps — (1) verify ownership (TXT), (2) point traffic
   (CNAME to the deployment's short domain; apex guidance) — and every Name and
   Value has a Copy button. A control is only counted as working when its
   observable effect is asserted, so each test reads the real clipboard after a
   real click.

   The bodies are what GET /domains sends (domains.service.ts toDto): `dns` is
   the TXT record, `routing` the record that points traffic (#784), absent from
   older API builds.

   Viewports: desktop and Pixel 7 (CI installs chromium only; iPhone 15/WebKit
   is exercised locally as evidence). */

const SHARED = { id: "dom_shared", domain: "snap.example.com", status: "live", ssl: "active", sslRenewsAt: null, links: 3, rootRedirect: null, notFoundRedirect: null, shared: true, dns: null, routing: null } as const;
const SUB = {
  id: "dom_sub",
  domain: "go.acme.test",
  status: "verifying",
  ssl: "pending",
  sslRenewsAt: null,
  links: 0,
  rootRedirect: null,
  notFoundRedirect: null,
  dns: { type: "TXT", name: "_snapurl.go.acme.test", value: "snapurl-verify-0123456789abcdef0123456789abcdef", ttl: 300 },
  routing: { type: "CNAME", name: "go.acme.test", value: "snap.example.com", ttl: 300 },
} as const;
const APEX = {
  id: "dom_apex",
  domain: "acme.test",
  status: "verifying",
  ssl: "pending",
  sslRenewsAt: null,
  links: 0,
  rootRedirect: null,
  notFoundRedirect: null,
  dns: { type: "TXT", name: "_snapurl.acme.test", value: "snapurl-verify-fedcba9876543210fedcba9876543210", ttl: 300 },
  routing: { type: "CNAME", name: "acme.test", value: "snap.example.com", ttl: 300 },
} as const;
// An API built before #784: no `routing` key at all.
const OLD_API = {
  id: "dom_old",
  domain: "old.acme.test",
  status: "verifying",
  ssl: "pending",
  sslRenewsAt: null,
  links: 0,
  rootRedirect: null,
  notFoundRedirect: null,
  dns: { type: "TXT", name: "_snapurl.old.acme.test", value: "snapurl-verify-oldoldoldoldoldoldoldoldoldold12", ttl: 300 },
} as const;

async function open(page: Page, domains: readonly unknown[]) {
  await seedMockSession(page);
  const api = await mockApi(page, {
    "GET /auth/me": { status: 200, body: { ...MOCK_USER, role: "owner" } },
    "GET /domains": { status: 200, body: [...domains, SHARED] },
    "GET /links": { status: 200, body: { items: [], total: 0, nextCursor: null } },
    "GET /bio-pages": { status: 200, body: [] },
    "GET /members": { status: 200, body: [] },
  });
  await page.goto("/domains");
  await expect(page.getByRole("heading", { name: "Domains" })).toBeVisible();
  return api;
}

const card = (page: Page, domain: string) => page.getByRole("region", { name: `Finish setting up ${domain}` });
const clipboard = (page: Page) => page.evaluate(() => navigator.clipboard.readText());

const VIEWPORTS = [
  { name: "desktop", use: { viewport: { width: 1440, height: 900 } } },
  { name: "Pixel 7", use: { viewport: devices["Pixel 7"].viewport, isMobile: true, hasTouch: true, userAgent: devices["Pixel 7"].userAgent } },
] as const;

for (const vp of VIEWPORTS) {
  test.describe(`Domains > DNS setup instructions (#784) — ${vp.name}`, () => {
    test.use(vp.use);
    test.beforeEach(async ({ context }) => {
      await context.grantPermissions(["clipboard-read", "clipboard-write"]);
    });

    test("shows BOTH records: ownership (TXT) and routing (CNAME), as two steps", async ({ page }) => {
      await open(page, [SUB]);
      const c = card(page, "go.acme.test");
      await expect(c).toBeVisible();
      await expect(c.getByRole("heading", { name: /step 1.*verify ownership/i })).toBeVisible();
      await expect(c.getByRole("heading", { name: /step 2.*point/i })).toBeVisible();
      await expect(c.getByText("_snapurl.go.acme.test", { exact: true })).toBeVisible();
      await expect(c.getByText(SUB.dns.value, { exact: true })).toBeVisible();
      await expect(c.getByText("CNAME", { exact: true })).toBeVisible();
      await expect(c.getByText("snap.example.com", { exact: true })).toBeVisible();
      await expect(c.getByText("2 records to add")).toBeVisible();
    });

    test("every Name and Value has a Copy button that really copies it", async ({ page }) => {
      await open(page, [SUB]);
      const fields: Array<[string, string]> = [
        ["Copy TXT name for go.acme.test", "_snapurl.go.acme.test"],
        ["Copy TXT value for go.acme.test", SUB.dns.value],
        ["Copy CNAME name for go.acme.test", "go.acme.test"],
        ["Copy CNAME value for go.acme.test", "snap.example.com"],
      ];
      for (const [label, expected] of fields) {
        const btn = card(page, "go.acme.test").getByRole("button", { name: label });
        await expect(btn, label).toBeVisible();
        await btn.click();
        expect(await clipboard(page), label).toBe(expected);
        // The click is acknowledged to the user and to a screen reader.
        await expect(btn, label).toHaveText("Copied");
        await expect(card(page, "go.acme.test").getByRole("status")).toContainText("Copied");
      }
    });

    test("Copy is keyboard-operable (focus + Enter) and the value stays selectable text", async ({ page }) => {
      await open(page, [SUB]);
      const btn = card(page, "go.acme.test").getByRole("button", { name: "Copy CNAME value for go.acme.test" });
      await btn.focus();
      await expect(btn).toBeFocused();
      await page.keyboard.press("Enter");
      expect(await clipboard(page)).toBe("snap.example.com");
      // The value is text, not a link-looking decoration.
      const value = card(page, "go.acme.test").getByText(SUB.dns.value, { exact: true });
      expect(await value.evaluate((el) => getComputedStyle(el).userSelect)).not.toBe("none");
      await expect(card(page, "go.acme.test").getByRole("link")).toHaveCount(0);
    });

    test("a copy that the browser refuses says so instead of claiming success", async ({ page }) => {
      await page.addInitScript(() => {
        Object.defineProperty(navigator.clipboard, "writeText", {
          value: () => Promise.reject(new DOMException("denied", "NotAllowedError")),
        });
      });
      await open(page, [SUB]);
      const btn = card(page, "go.acme.test").getByRole("button", { name: "Copy CNAME value for go.acme.test" });
      await btn.click();
      await expect(card(page, "go.acme.test").getByRole("alert")).toContainText(/couldn.t copy/i);
      await expect(btn).not.toHaveText("Copied");
      await expect(card(page, "go.acme.test").getByText("snap.example.com", { exact: true })).toBeVisible();
    });

    test("a root domain is told a CNAME may not work there, and what to use instead", async ({ page }) => {
      await open(page, [APEX]);
      const c = card(page, "acme.test");
      await expect(c.getByText(/root domain/i)).toBeVisible();
      await expect(c.getByText(/ALIAS/)).toBeVisible();
      await expect(c.getByText(/ANAME/)).toBeVisible();
    });

    test("a subdomain gets no root-domain warning", async ({ page }) => {
      await open(page, [SUB]);
      await expect(card(page, "go.acme.test").getByText(/root domain/i)).toHaveCount(0);
    });

    test("an older API without `routing` still shows the TXT step and does not crash", async ({ page }) => {
      await open(page, [OLD_API]);
      const c = card(page, "old.acme.test");
      await expect(c.getByText(OLD_API.dns.value, { exact: true })).toBeVisible();
      await expect(c.getByRole("heading", { name: /step 2/i })).toHaveCount(0);
      await expect(c.getByText("1 record to add")).toBeVisible();
      await c.getByRole("button", { name: "Copy TXT value for old.acme.test" }).click();
      expect(await clipboard(page)).toBe(OLD_API.dns.value);
    });

    test("every pending domain gets its own card, not just the first", async ({ page }) => {
      await open(page, [SUB, APEX]);
      await expect(card(page, "go.acme.test")).toBeVisible();
      await expect(card(page, "acme.test")).toBeVisible();
      await card(page, "acme.test").getByRole("button", { name: "Copy TXT value for acme.test" }).click();
      expect(await clipboard(page)).toBe(APEX.dns.value);
    });

    test("no configuration variable name leaks into the instructions", async ({ page }) => {
      await open(page, [SUB, APEX]);
      const text = await page.locator("main").innerText();
      expect(text).not.toMatch(/\b[A-Z]{3,}_[A-Z_]{2,}\b/);
    });

    test("the setup card never makes the page scroll sideways", async ({ page }) => {
      await open(page, [SUB]);
      await expect(card(page, "go.acme.test")).toBeVisible();
      const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
      expect(overflow).toBeLessThanOrEqual(0);
      // Copy buttons stay reachable by touch (>= 24px target, WCAG 2.5.8).
      const box = await card(page, "go.acme.test").getByRole("button", { name: "Copy TXT value for go.acme.test" }).boundingBox();
      expect(box!.height).toBeGreaterThanOrEqual(24);
      expect(box!.width).toBeGreaterThanOrEqual(24);
    });
  });
}
