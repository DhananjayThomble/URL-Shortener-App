import { expect, test } from "@playwright/test";
import { fakeAccessToken, MOCK_USER, MOCK_WORKSPACE, mockApi, nestError, seedMockSession } from "../support/mock-api";

/* E2E journeys (#646): a wrong credential must read as a wrong credential.

   Three credential checks answered HTTP 401 and the client turned every 401 that
   was not on its exact-match list into "Your session has expired. Sign in again to
   continue." — so a mistyped unlock password, a mistyped 2FA code, or a mistyped
   password while turning 2FA off all told the person their session was gone. The
   disable case also ran a refresh-token rotation and sent the request a second time.

   That logic is in the REAL API client (web/src/lib/api/client.ts), which fixtures
   mode bypasses, so this lane builds the app with fixtures off and answers /api/v1
   in the browser (support/mock-api.ts). Status codes and messages below are the ones
   the API sends:
     apps/api/src/public/public.service.ts:88   401 "That password isn't right."
     apps/api/src/auth/auth.service.ts:362      401 "That code isn't right. Try the next one from your app."
     apps/api/src/auth/auth.service.ts:417      401 "That password isn't right."  (2fa/disable)
   The Newman collection (qa/postman) asserts the same against the real API. */

const SESSION_EXPIRED = /session has expired/i;

const PREVIEW = {
  shortUrl: "snap.to/vault",
  destination: "https://acme.com/private",
  createdAt: "2026-01-01T00:00:00.000Z",
  createdBy: "Mock Workspace",
  verifiedDomain: true,
  safeBrowsing: "clean",
  scannedAt: "2026-01-01T00:00:00.000Z",
  setsCookies: false,
  redirectType: "302",
} as const;

test.describe("wrong credential is not 'session expired' (#646)", () => {
  test("protected link: a wrong password says the password is wrong", async ({ page }) => {
    const api = await mockApi(page, {
      "GET /public/links/vault/preview": { status: 200, body: PREVIEW },
      "POST /public/links/vault/unlock": nestError(401, "That password isn't right."),
    });

    await page.goto("/p/vault?unlock=1");
    await expect(page.getByText("This link is password protected")).toBeVisible();
    await page.getByPlaceholder("Password").fill("not-the-password");
    await page.getByRole("button", { name: "Unlock and continue" }).click();

    await expect(page.getByText("That password isn't right.")).toBeVisible();
    await expect(page.getByText(SESSION_EXPIRED)).toHaveCount(0);
    // The visitor can retry: still on the unlock form, one request made, no refresh attempt.
    await expect(page.getByRole("button", { name: "Unlock and continue" })).toBeVisible();
    expect(api.callsTo("POST", "/public/links/vault/unlock")).toHaveLength(1);
    expect(api.callsTo("POST", "/auth/refresh")).toHaveLength(0);
  });

  test("2FA sign-in: a wrong code says the code is wrong", async ({ page }) => {
    const api = await mockApi(page, {
      "POST /auth/login": { status: 200, body: { challenge: "totp", challengeToken: "challenge-token" } },
      "POST /auth/2fa/verify": nestError(401, "That code isn't right. Try the next one from your app."),
    });

    await page.goto("/login");
    await page.getByPlaceholder("you@company.com").fill(MOCK_USER.email);
    await page.getByPlaceholder("••••••••").fill("correct horse battery");
    await page.getByRole("button", { name: "Sign in" }).click();

    const code = page.getByRole("textbox", { name: "Authentication code" });
    await expect(code).toBeVisible();
    await code.fill("000000");
    await page.getByRole("button", { name: "Verify" }).click();

    await expect(page.getByText("That code isn't right. Try the next one from your app.")).toBeVisible();
    await expect(page.getByText(SESSION_EXPIRED)).toHaveCount(0);
    await expect(page).toHaveURL(/\/login$/);
    expect(api.callsTo("POST", "/auth/2fa/verify")).toHaveLength(1);
    expect(api.callsTo("POST", "/auth/refresh")).toHaveLength(0);
  });

  /* Signed-in settings page for a member whose 2FA is on. */
  const signedInHandlers = {
    "GET /auth/me": { status: 200, body: MOCK_USER },
    "GET /workspaces/current": { status: 200, body: MOCK_WORKSPACE },
    "GET /auth/workspaces": {
      status: 200,
      body: [{ id: MOCK_WORKSPACE.id, name: MOCK_WORKSPACE.name, initials: MOCK_WORKSPACE.initials, role: "owner", current: true }],
    },
    "GET /members": {
      status: 200,
      body: [
        {
          id: "mem_1",
          name: MOCK_USER.name,
          email: MOCK_USER.email,
          role: "owner",
          status: "active",
          links: 0,
          lastActive: null,
          invitedAt: null,
          twoFactor: true,
          initials: MOCK_USER.initials,
        },
      ],
    },
  } as const;

  async function openTurnOffForm(page: import("@playwright/test").Page) {
    await seedMockSession(page, fakeAccessToken(MOCK_WORKSPACE.id));
    await page.goto("/settings");
    await expect(page.getByText("Two-factor authentication", { exact: true })).toBeVisible();
    await page.getByRole("button", { name: "Turn off two-factor" }).click();
    await expect(page.getByLabel("Password")).toBeVisible();
  }

  test("turning 2FA off: a wrong password says the password is wrong, with no refresh or retry", async ({ page }) => {
    const api = await mockApi(page, {
      ...signedInHandlers,
      "POST /auth/2fa/disable": nestError(401, "That password isn't right."),
    });

    await openTurnOffForm(page);
    await page.getByLabel("Password").fill("wrong-password");
    await page.getByRole("button", { name: "Turn off two-factor" }).click();

    await expect(page.getByText("That password isn't right.")).toBeVisible();
    await expect(page.getByText(SESSION_EXPIRED)).toHaveCount(0);
    // A wrong password is final: one request, the refresh token is not rotated, the page stays signed in.
    expect(api.callsTo("POST", "/auth/2fa/disable")).toHaveLength(1);
    expect(api.callsTo("POST", "/auth/refresh")).toHaveLength(0);
    await expect(page).toHaveURL(/\/settings$/);
    await expect(page.getByLabel("Password")).toBeVisible();
  });

  test("turning 2FA off: an expired access token is still refreshed and retried (guard against over-matching)", async ({
    page,
  }) => {
    const api = await mockApi(page, {
      ...signedInHandlers,
      // The auth guard's 401 for an expired access token — apps/api/src/auth/auth.guard.ts:100.
      "POST /auth/2fa/disable": (_req, nth) => (nth === 1 ? nestError(401, "Sign in to continue.") : { status: 204 }),
      "POST /auth/refresh": {
        status: 200,
        body: { accessToken: fakeAccessToken(MOCK_WORKSPACE.id), refreshToken: "mock.refresh.token.2" },
      },
    });

    await openTurnOffForm(page);
    await page.getByLabel("Password").fill("right-password");
    await page.getByRole("button", { name: "Turn off two-factor" }).click();

    // Refresh once, send the disable request again, and the form closes without an error.
    await expect.poll(() => api.callsTo("POST", "/auth/2fa/disable").length).toBe(2);
    expect(api.callsTo("POST", "/auth/refresh")).toHaveLength(1);
    await expect(page.getByLabel("Password")).toHaveCount(0);
    await expect(page.getByText(SESSION_EXPIRED)).toHaveCount(0);
  });
});
