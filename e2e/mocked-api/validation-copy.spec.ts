import { expect, test, type Page } from "@playwright/test";
import { fakeAccessToken, MOCK_USER, MOCK_WORKSPACE, mockApi, seedMockSession, type MockReply } from "../support/mock-api";

/* #792 — validation errors must reach people as plain sentences.

   QA saw "name: Too big: expected string to have <=80 characters" on /register,
   three contradictory "destination: …" lines for one bad bulk row, "endpoint:
   That host isn't allowed" on /developers, and "Invalid email address" for an
   EMPTY /forgot-password box.

   Every case drives the real page with real clicks and reads what is on screen.
   The mock answers like the API does: the NEW sentences (apps/api/src/common/
   zod.pipe.ts) and — to cover deploy skew, a cached tab against an older API —
   the OLD prefixed zod strings. Neither may put a `field:` prefix or zod English
   on screen. (The real API's own wording is asserted in apps/api
   zod.pipe.messages.test.ts and the j792 journey.) */

const badRequest = (message: string[], issues: Array<{ path: string; message: string }> = []): MockReply => ({
  status: 400,
  body: { statusCode: 400, error: "Bad Request", message, issues },
});

const BASE = {
  "GET /auth/me": { status: 200, body: MOCK_USER },
  "GET /workspaces/current": { status: 200, body: MOCK_WORKSPACE },
  "GET /auth/workspaces": {
    status: 200,
    body: [{ id: MOCK_WORKSPACE.id, name: MOCK_WORKSPACE.name, initials: MOCK_WORKSPACE.initials, role: "owner", current: true }],
  },
} satisfies Record<string, MockReply>;

/** Nothing on screen may look like a field path or zod's own English. */
async function expectNoDeveloperEnglish(page: Page) {
  const body = (await page.locator("body").innerText()).replace(/\s+/g, " ");
  expect(body).not.toMatch(/\b(name|email|password|destination|endpoint|events|slug): /);
  expect(body).not.toMatch(/Too big|Too small|Invalid input|Invalid email address|expected string/);
}

test.describe("/forgot-password, submitted empty (#792)", () => {
  test("says the email is required, not 'Invalid email address'", async ({ page }) => {
    const api = await mockApi(page, {});
    await page.goto("/forgot-password");
    await page.getByRole("button", { name: "Send reset link" }).click();

    await expect(page.getByText("Email is required")).toBeVisible();
    await expect(page.getByText("Invalid email address")).toHaveCount(0);
    // Client-side validation stopped it: nothing was sent.
    expect(api.callsTo("POST", "/auth/password-reset/request")).toHaveLength(0);
    await expectNoDeveloperEnglish(page);
  });
});

test.describe("/register (#792)", () => {
  test("the name box stops at the server's 80-character limit instead of failing later", async ({ page }) => {
    const api = await mockApi(page, {});
    await page.goto("/register");
    const name = page.getByLabel("Name");
    await expect(name).toHaveAttribute("maxlength", "80");
    await name.fill("n".repeat(120));
    await expect(name).toHaveValue("n".repeat(80));
    await expect(page.getByLabel("Password")).toHaveAttribute("maxlength", "200");
    expect(api.callsTo("POST", "/auth/register")).toHaveLength(0);
  });

  for (const [label, message] of [
    ["the current API's sentence", ["Name must be 80 characters or fewer"]],
    ["an older API's raw zod string", ["name: Too big: expected string to have <=80 characters"]],
  ] as const) {
    test(`a rejected sign-up shows plain English — ${label}`, async ({ page }) => {
      await mockApi(page, { "POST /auth/register": badRequest([...message]) });
      await page.goto("/register");
      await page.getByLabel("Name").fill("Priya Raman");
      await page.getByLabel("Email").fill("priya@example.com");
      await page.getByLabel("Password").fill("a-long-enough-password");
      await page.getByRole("button", { name: "Create account" }).click();

      await expect(page.getByText("Name must be 80 characters or fewer")).toBeVisible();
      await expectNoDeveloperEnglish(page);
    });
  }
});

test.describe("bulk create (#792)", () => {
  const DOMAIN = {
    id: "dom_snap", domain: "snap.to", status: "live", ssl: "active", sslRenewsAt: null, links: 0,
    rootRedirect: null, notFoundRedirect: null, shared: true, dns: null,
  };

  for (const [label, error] of [
    ["the current API: one sentence", "Enter an absolute http(s) URL."],
    ["an older API: prefixed", "destination: Enter an absolute http(s) URL"],
  ] as const) {
    test(`one bad line is one plain sentence — ${label}`, async ({ page }) => {
      await mockApi(page, {
        ...BASE,
        "GET /domains": { status: 200, body: [DOMAIN] },
        "GET /links": { status: 200, body: { items: [], total: 0, nextCursor: null } },
        "GET /members": { status: 200, body: [] },
      });
      await page.route("**/api/v1/links/bulk", (route) =>
        route.fulfill({
          status: 200,
          contentType: "application/json",
          body: JSON.stringify({
            created: 0, skipped: 0, failed: 1,
            results: [{ ok: false, index: 0, destination: "not a url", error }],
          }),
        }),
      );
      await seedMockSession(page, fakeAccessToken(MOCK_WORKSPACE.id));
      await page.goto("/links");
      await page.getByRole("button", { name: "Bulk create" }).click();
      await page.getByLabel("One link per line").fill("not a url");
      await page.getByRole("button", { name: "Create 1 link" }).click();

      await expect(page.getByText("Nothing was created.")).toBeVisible();
      const row = page.getByRole("listitem").filter({ hasText: "not a url" });
      await expect(row.getByText(/^Enter an absolute http\(s\) URL\.?$/)).toHaveCount(1);
      await expect(row).not.toContainText("destination:");
    });
  }
});

test.describe("/developers webhooks (#792)", () => {
  for (const [label, message] of [
    ["the current API", ["That host isn't allowed (private, loopback or link-local address)"]],
    ["an older API", ["endpoint: That host isn't allowed (private, loopback or link-local address)"]],
  ] as const) {
    test(`a private endpoint is refused in plain English — ${label}`, async ({ page }) => {
      const api = await mockApi(page, {
        ...BASE,
        "GET /api-keys": { status: 200, body: [] },
        "GET /webhooks": { status: 200, body: [] },
        "POST /webhooks": badRequest([...message], [{ path: "endpoint", message: message[0]! }]),
      });
      await seedMockSession(page, fakeAccessToken(MOCK_WORKSPACE.id));
      await page.goto("/developers");
      await page.getByRole("button", { name: "＋ Add endpoint" }).click();
      await page.getByPlaceholder("https://example.com/hooks/snapurl").fill("http://10.0.0.5/hook");
      await page.getByRole("button", { name: "Add endpoint", exact: true }).click();

      await expect(page.getByText("That host isn't allowed (private, loopback or link-local address)")).toBeVisible();
      expect(api.callsTo("POST", "/webhooks")).toHaveLength(1);
      await expectNoDeveloperEnglish(page);
    });
  }

  test("the API key name box stops at the server's 60-character limit", async ({ page }) => {
    await mockApi(page, { ...BASE, "GET /api-keys": { status: 200, body: [] }, "GET /webhooks": { status: 200, body: [] } });
    await seedMockSession(page, fakeAccessToken(MOCK_WORKSPACE.id));
    await page.goto("/developers");
    await page.getByRole("button", { name: "＋ New API key" }).click();
    const name = page.getByPlaceholder("CI deploy bot");
    await expect(name).toHaveAttribute("maxlength", "60");
    await name.fill("k".repeat(100));
    await expect(name).toHaveValue("k".repeat(60));
  });
});
