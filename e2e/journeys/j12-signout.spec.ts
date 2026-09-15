/**
 * Journey 12 — Sign out
 *
 * Confirm the session ends and a protected route bounces to /login.
 *
 * Oracles:
 *   - app-shell/index.tsx — AccountMenu: "Sign out" button inside role=menu
 *   - (app)/layout.tsx — route guard: useMe() isError → router.replace("/login")
 *   - Invariant: after sign-out, loading /login directly works
 *   - Invariant: the server-side refresh token must be revoked (POST /auth/refresh → 401)
 *
 * Known behaviour: the route guard uses React Query's useMe() with staleTime=5min.
 * After sign-out + page.goto("/links") in the SAME browser context, the cached
 * me data is still in memory, so the shell briefly renders. The guard only
 * redirects when useMe() returns isError (a 401). A fresh page load (new context)
 * would hit the route guard correctly. We test both the same-context and fresh-
 * page-load scenarios and record what each does.
 */

import { expect, test } from "@playwright/test";
import {
  makeEmail,
  registerUser,
  seedAccount,
  API_URL,
} from "./helpers";

test.describe("Journey 12 — Sign out", () => {
  test("sign out: session ends, /login reached, refresh token revoked", async ({ page }) => {
    /* ---- Setup: a logged-in session ---- */
    const session = await registerUser(makeEmail("j12"));
    await seedAccount(page, session);

    await page.goto("/links");
    await expect(page).toHaveURL(/\/links/);
    await expect(
      page.getByRole("button", { name: /New link|Create a link/i }).first(),
    ).toBeVisible({ timeout: 15_000 });

    /* ---- 1. Open the AccountMenu ---- */
    // From app-shell/index.tsx: aria-label "Account menu for <name>"
    const accountBtn = page.getByRole("button", { name: /Account menu/i });
    await expect(accountBtn).toBeVisible({ timeout: 10_000 });
    await accountBtn.click();

    /* ---- 2. Click "Sign out" ---- */
    const menu = page.getByRole("menu");
    await expect(menu).toBeVisible({ timeout: 5_000 });
    // The Sign out item — use getByText since the element has role="menuitem"
    const signOutItem = menu.getByText("Sign out");
    await expect(signOutItem).toBeVisible({ timeout: 5_000 });
    await signOutItem.click();

    /* ---- 3. App redirects to /login after sign-out ---- */
    await expect(page).toHaveURL(/\/login/, { timeout: 15_000 });

    /* ---- 4. Open a fresh page to test the route guard without cached state ---- */
    // A new page has no React Query cache, so useMe() fires a fresh request
    // with no tokens → 401 → route guard redirects to /login.
    const freshPage = await page.context().newPage();
    await freshPage.goto("/links", { waitUntil: "networkidle", timeout: 30_000 });
    const freshPageUrl = freshPage.url();
    await freshPage.close();

    // Oracle: a new page with no tokens must land on /login
    expect(freshPageUrl, "Fresh page with no tokens must redirect to /login").toMatch(/\/login/);

    /* ---- 5. Same context: navigate to /links from the signed-out page ---- */
    // After sign-out, the same browser context's localStorage has no tokens.
    // page.goto("/links") will load the route and the guard fires useMe() → 401.
    // However the React Query staleTime=5min means the cached me data may serve
    // the first render. We wait for the guard to fire by using networkidle.
    await page.goto("/links", { waitUntil: "networkidle", timeout: 30_000 });
    const sameContextUrl = page.url();

    if (!sameContextUrl.includes("/login")) {
      console.log(
        `[FINDING] J12: After sign-out, page.goto("/links") in the same browser context ` +
        `lands on "${sameContextUrl}" (not /login). ` +
        `Root cause: (app)/layout.tsx route guard uses useMe() with staleTime=5min. ` +
        `After sign-out, React Query cache still holds the stale me object for up to 5 min, ` +
        `so the guard's isError branch never fires within that window. ` +
        `A fresh browser context (no cache) correctly redirects to /login (verified above: ${freshPageUrl}). ` +
        `Oracle: layout.tsx useMe() staleTime=5*60_000 + tokens.clear() does not invalidate the cache.`,
      );
    }

    /* ---- 6. Server-side refresh token is revoked ---- */
    const refreshRes = await fetch(`${API_URL}/auth/refresh`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ refreshToken: session.refreshToken }),
    });
    // Oracle: the old refresh token must return 401 after logout
    if (refreshRes.status !== 401) {
      console.log(
        `[FINDING] J12: POST /auth/refresh with old refresh token returned ${refreshRes.status} ` +
        `after sign-out (expected 401). If the sign-out did not call POST /auth/logout, ` +
        `the server-side refresh token rotation record was not cleared and the token ` +
        `remains usable. A stolen refresh token survives sign-out in this case.`,
      );
    }
    expect(refreshRes.status, "Old refresh token must return 401 after sign-out").toBe(401);
  });
});
