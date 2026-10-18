import { expect, test } from "@playwright/test";
import { mockApi } from "../support/mock-api";

/* E2E: the public trust page never reveals a password-protected link's
   destination.

   The page used to render the destination under "Where it goes" and as the href
   of a "Continue to …" link on a protected link's page — so the password guarded
   nothing: the URL was right there, and following it skipped both the password
   and click recording.

   Oracle: PublicLinkPreview (packages/contract/src/public.ts) — a protected
   link's preview carries `passwordProtected: true` and `destination: null`, and
   the only way through is POST /public/links/:slug/unlock, which returns a
   token the redirect checks (apps/redirect/src/main.ts, G3).

   Runs in the mocked-API lane so the response is exactly what the API sends —
   and, for the defence-in-depth case, exactly what it must never send. */

const SECRET = "https://acme.com/private-board-deck";

const LOCKED = {
  shortUrl: "snap.to/vault",
  destination: null,
  passwordProtected: true,
  createdAt: "2026-01-01T00:00:00.000Z",
  createdBy: "Mock Workspace",
  verifiedDomain: true,
  safeBrowsing: "clean",
  scannedAt: "2026-01-01T00:00:00.000Z",
  setsCookies: false,
  redirectType: "302",
} as const;

const OPEN = { ...LOCKED, shortUrl: "snap.to/open", destination: "https://acme.com/pricing", passwordProtected: false };

async function expectLocked(page: import("@playwright/test").Page) {
  await expect(page.getByText("This link is password protected")).toBeVisible();
  await expect(page.getByRole("button", { name: "Unlock and continue" })).toBeVisible();
  await expect(page.getByText(/Hidden until you enter the password/)).toBeVisible();
  await expect(page.getByRole("link", { name: /^Continue( anyway)? to / })).toHaveCount(0);
}

test.describe("public trust page: password-protected link", () => {
  test("arriving from the redirect (?unlock=1) shows the password form and no destination", async ({ page }) => {
    await mockApi(page, { "GET /public/links/vault/preview": { status: 200, body: LOCKED } });
    await page.goto("/p/vault?unlock=1");
    await expectLocked(page);
    await expect(page.getByPlaceholder("Password")).toBeFocused();
  });

  test('the "+" preview (no ?unlock) of a protected link also asks for the password', async ({ page }) => {
    await mockApi(page, { "GET /public/links/vault/preview": { status: 200, body: LOCKED } });
    await page.goto("/p/vault");
    await expectLocked(page);
  });

  test("a protected link's destination is never rendered, even if a response carried one", async ({ page }) => {
    await mockApi(page, {
      "GET /public/links/vault/preview": { status: 200, body: { ...LOCKED, destination: SECRET } },
    });
    await page.goto("/p/vault?unlock=1");
    await expectLocked(page);
    expect(await page.content()).not.toContain(SECRET);
  });

  test("the right password goes back through the short link with an unlock token", async ({ page }) => {
    const api = await mockApi(page, {
      "GET /public/links/vault/preview": { status: 200, body: LOCKED },
      "POST /public/links/vault/unlock": { status: 200, body: { unlockToken: "tok_123", expiresIn: 300 } },
    });
    // Stand in for the redirect service so the navigation lands somewhere observable.
    let redirectedTo = "";
    await page.route("https://snap.to/**", async (route) => {
      redirectedTo = route.request().url();
      await route.fulfill({ status: 200, contentType: "text/html", body: "<p>redirect</p>" });
    });

    await page.goto("/p/vault?unlock=1");
    await page.getByPlaceholder("Password").fill("hunter2");
    await page.getByRole("button", { name: "Unlock and continue" }).click();

    await expect.poll(() => redirectedTo).toBe("https://snap.to/vault?k=tok_123");
    expect(api.callsTo("POST", "/public/links/vault/unlock")[0]?.body).toEqual({ password: "hunter2" });
  });

  test("a stale ?unlock=1 on a link with no password shows the normal Continue link", async ({ page }) => {
    await mockApi(page, { "GET /public/links/open/preview": { status: 200, body: OPEN } });
    await page.goto("/p/open?unlock=1");
    await expect(page.getByRole("link", { name: /^Continue to acme\.com/ })).toHaveAttribute(
      "href",
      "https://acme.com/pricing",
    );
    await expect(page.getByText("This link is password protected")).toHaveCount(0);
  });
});
