import { expect, test, type Page } from "@playwright/test";
import { mockApi } from "../support/mock-api";

/* E2E (#764): the "+" preview says what a visitor following the link actually
   gets.

   The page said "This link is safe to open" with a Continue button to the
   destination for an expired link (QA saw it on an expired link with a country
   rule), because the preview carried no lifecycle and the page decided from
   Safe Browsing alone.

   Oracle: PublicLinkPreview.state / hasRules / hasFallback
   (packages/contract/src/public.ts), which the API computes with the
   redirect's own gate (lifecycleGate, @snapurl/domain): an expired link 302s
   to its fallback or answers 410, a reached click limit 410, a not-yet-live
   link its fallback or 404, an archived link 410. Each case asserts the
   heading, that the destination is not offered, and where Continue really
   goes after a click. */

const DEST = "https://acme.com/sale";

const BASE = {
  shortUrl: "snap.to/promo",
  destination: DEST,
  passwordProtected: false,
  createdAt: "2026-01-01T00:00:00.000Z",
  createdBy: "Mock Workspace",
  verifiedDomain: true,
  safeBrowsing: "clean",
  scannedAt: "2026-01-01T00:00:00.000Z",
  setsCookies: false,
  redirectType: "302",
  state: "active",
  expiresAt: null,
  activatesAt: null,
  hasRules: false,
  hasFallback: false,
} as const;

async function open(page: Page, body: Record<string, unknown>, query = "") {
  await mockApi(page, { "GET /public/links/promo/preview": { status: 200, body: { ...BASE, ...body } } });
  await page.goto(`/p/promo${query}`);
}

/** Stand in for the redirect so a click through the short link lands somewhere observable. */
async function catchShortLink(page: Page): Promise<() => string> {
  let to = "";
  await page.route("https://snap.to/**", async (route) => {
    to = route.request().url();
    await route.fulfill({ status: 200, contentType: "text/html", body: "<p>redirect</p>" });
  });
  return () => to;
}

async function expectNoWayToDestination(page: Page) {
  await expect(page.getByText("This link is safe to open")).toHaveCount(0);
  await expect(page.getByRole("link", { name: /^Continue( anyway)? to (?!the owner's page)/ })).toHaveCount(0);
  await expect(page.locator(`a[href="${DEST}"]`)).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Unlock and continue" })).toHaveCount(0);
}

test.describe("public trust page: link state (#764)", () => {
  test("an expired link says so, with its date, and offers no Continue", async ({ page }) => {
    await open(page, { state: "expired", expiresAt: "2026-02-01T10:00:00.000Z" });
    await expect(page.getByRole("heading", { name: "This link has expired" })).toBeVisible();
    await expect(page.getByText(/^Nowhere\. The link stopped working when it expired\./)).toBeVisible();
    await expect(page.getByText("Expired", { exact: true })).toBeVisible();
    await expect(page.getByText(/1 Feb 2026|Feb 1, 2026/)).toBeVisible();
    await expectNoWayToDestination(page);
    await expect(page.getByRole("link", { name: "Continue to the owner's page →" })).toHaveCount(0);
  });

  test("an expired link with a fallback: Continue goes back through the short link", async ({ page }) => {
    const landed = await catchShortLink(page);
    await open(page, { state: "expired", hasFallback: true, hasRules: true });
    await expect(page.getByRole("heading", { name: "This link has expired" })).toBeVisible();
    await expect(page.getByText(/the owner sends visitors to a different page/)).toBeVisible();
    // No visitor reaches the rules of an expired link, so no rules note.
    await expect(page.getByText(/This link has routing rules/)).toHaveCount(0);
    await expectNoWayToDestination(page);
    await page.getByRole("link", { name: "Continue to the owner's page →" }).click();
    await expect.poll(landed).toBe("https://snap.to/promo");
  });

  test("a link at its click limit says so and offers no Continue", async ({ page }) => {
    await open(page, { state: "click_limit" });
    await expect(page.getByRole("heading", { name: "This link has reached its click limit" })).toBeVisible();
    await expectNoWayToDestination(page);
    await expect(page.getByRole("link", { name: /owner's page/ })).toHaveCount(0);
  });

  test("a link that is not live yet says when it goes live", async ({ page }) => {
    await open(page, { state: "scheduled", activatesAt: "2026-11-01T09:00:00.000Z" });
    await expect(page.getByRole("heading", { name: "This link isn't live yet" })).toBeVisible();
    await expect(page.getByText("Goes live", { exact: true })).toBeVisible();
    await expect(page.getByText(/^Nowhere yet\./)).toBeVisible();
    await expectNoWayToDestination(page);
  });

  test("an archived link says it is no longer active, even when flagged", async ({ page }) => {
    await open(page, { state: "archived", safeBrowsing: "flagged" });
    await expect(page.getByRole("heading", { name: "This link is no longer active" })).toBeVisible();
    await expectNoWayToDestination(page);
  });

  test("a protected, expired link shows the expiry, not the password form", async ({ page }) => {
    await open(page, { state: "expired", passwordProtected: true, destination: null, hasFallback: null }, "?unlock=1");
    await expect(page.getByRole("heading", { name: "This link has expired" })).toBeVisible();
    await expect(page.getByText("This link is password protected")).toHaveCount(0);
    await expect(page.getByPlaceholder("Password")).toHaveCount(0);
    // Nothing either way about a fallback for a protected link (#802).
    await expect(page.getByText(/different page|^Nowhere/)).toHaveCount(0);
    await expectNoWayToDestination(page);
  });

  test("a link with routing rules says the destination may vary; Continue goes through the short link", async ({ page }) => {
    const landed = await catchShortLink(page);
    await open(page, { hasRules: true });
    await expect(page.getByRole("heading", { name: "This link is safe to open" })).toBeVisible();
    await expect(page.getByText(/some visitors are sent to a different page/)).toBeVisible();
    await expect(page.getByText(DEST)).toBeVisible();
    await page.getByRole("link", { name: "Continue to snap.to/promo →" }).click();
    await expect.poll(landed).toBe("https://snap.to/promo");
  });

  test("an active link with an expiry ahead shows it and still continues to the destination", async ({ page }) => {
    await open(page, { expiresAt: "2026-12-24T18:30:00.000Z" });
    await expect(page.getByRole("heading", { name: "This link is safe to open" })).toBeVisible();
    await expect(page.getByText("Expires", { exact: true })).toBeVisible();
    await expect(page.getByRole("link", { name: "Continue to acme.com →" })).toHaveAttribute("href", DEST);
  });

  test("deploy skew — an older API without the new fields renders the old page", async ({ page }) => {
    const { state, expiresAt, activatesAt, hasRules, hasFallback, ...old } = BASE;
    void [state, expiresAt, activatesAt, hasRules, hasFallback];
    await mockApi(page, { "GET /public/links/promo/preview": { status: 200, body: old } });
    await page.goto("/p/promo");
    await expect(page.getByRole("heading", { name: "This link is safe to open" })).toBeVisible();
    await expect(page.getByRole("link", { name: "Continue to acme.com →" })).toHaveAttribute("href", DEST);
    await expect(page.getByText(/didn't load|unexpected shape/)).toHaveCount(0);
  });

  test("the expired state reads in dark mode too", async ({ page }) => {
    await page.emulateMedia({ colorScheme: "dark" });
    await open(page, { state: "expired" });
    await expect(page.getByRole("heading", { name: "This link has expired" })).toBeVisible();
    await expectNoWayToDestination(page);
  });
});
