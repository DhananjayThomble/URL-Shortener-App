import { expect, test, type Page } from "@playwright/test";
import { MOCK_USER, mockApi, seedMockSession } from "../support/mock-api";

/* E2E (#966): custom domains are a paid-plan feature.

   The Domains page gates the add form on the workspace plan's entitlements
   (@snapurl/contract entitlementsFor), exactly as the API gates POST /domains.
   A Free workspace sees an upgrade prompt and no add form; a paid workspace
   keeps the add affordance. Existing custom domains are listed on both — the
   gate is on connecting a NEW one, never on removing an existing one.

   The false "SSL is issued automatically and renews itself" copy is gone from
   the page header on every plan. */

const OWN = {
  id: "dom_own",
  domain: "go.acme.test",
  status: "live",
  ssl: "active",
  sslRenewsAt: "2027-01-05T00:00:00.000Z",
  links: 1,
  rootRedirect: null,
  notFoundRedirect: null,
  dns: null,
} as const;

async function open(page: Page, plan: string) {
  await seedMockSession(page);
  const api = await mockApi(page, {
    "GET /auth/me": { status: 200, body: { ...MOCK_USER, role: "owner", plan } },
    "GET /domains": { status: 200, body: [OWN] },
    "GET /links": { status: 200, body: { items: [], total: 0, nextCursor: null } },
    "GET /bio-pages": { status: 200, body: [] },
    "GET /members": { status: 200, body: [] },
  });
  await page.goto("/domains");
  await expect(page.getByRole("heading", { name: "Domains" })).toBeVisible();
  return api;
}

test.describe("Domains > plan gate (#966)", () => {
  test("a Free workspace cannot add a custom domain: upgrade prompt, no add form", async ({ page }) => {
    await open(page, "Free");

    // No add affordance at all.
    await expect(page.getByRole("button", { name: /add domain/i })).toHaveCount(0);

    // An upgrade prompt is shown instead.
    await expect(page.getByRole("heading", { name: /custom domains are a paid feature/i })).toBeVisible();
    await expect(page.getByText(/Free/).first()).toBeVisible();

    // The existing custom domain is still listed — the gate never removes it.
    await expect(page.getByRole("row").filter({ hasText: "go.acme.test" })).toBeVisible();
  });

  test("a paid workspace can add a custom domain: the add form opens", async ({ page }) => {
    await open(page, "Pro");

    // No upgrade prompt.
    await expect(page.getByRole("heading", { name: /custom domains are a paid feature/i })).toHaveCount(0);

    // The add control is present and opens the form.
    const addButton = page.getByRole("button", { name: /add domain/i });
    await expect(addButton).toBeVisible();
    await addButton.click();
    await expect(page.getByRole("heading", { name: "Add a domain" })).toBeVisible();
    await expect(page.getByPlaceholder("go.example.com")).toBeVisible();
  });

  test("the false auto-SSL claim is gone from the page header", async ({ page }) => {
    await open(page, "Pro");
    await expect(page.getByText(/SSL is issued automatically and renews itself/i)).toHaveCount(0);
  });
});
