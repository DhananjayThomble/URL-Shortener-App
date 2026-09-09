import type { Page } from "@playwright/test";

/* Auth in the dashboard is plain localStorage with client-side route protection
   (web/src/lib/api/client.ts: TOKEN_KEY / REFRESH_KEY). In fixtures mode the fake
   backend returns its SESSION for any credentials, and these are the exact token
   values it hands out — so seeding them makes the app treat us as logged in
   without driving the login form on every test. */
const TOKEN_KEY = "snapurl.accessToken";
const REFRESH_KEY = "snapurl.refreshToken";
const FIXTURE_ACCESS = "fixture.access.token";
const FIXTURE_REFRESH = "fixture.refresh.token";

/**
 * Seed an authenticated session BEFORE the app boots. Must be called before the
 * first navigation — addInitScript runs on every document load in the context,
 * so the token is present when the client-side route guard first evaluates.
 */
export async function seedSession(page: Page): Promise<void> {
  await page.addInitScript(
    ([tokenKey, refreshKey, access, refresh]) => {
      window.localStorage.setItem(tokenKey, access);
      window.localStorage.setItem(refreshKey, refresh);
    },
    [TOKEN_KEY, REFRESH_KEY, FIXTURE_ACCESS, FIXTURE_REFRESH] as const,
  );
}

/**
 * Reset fixture state. Fixture data lives in module-level arrays in
 * web/src/lib/api/fixtures.ts: it SURVIVES client-side (SPA) navigation but is
 * RE-INITIALISED on a full document load. There is no exported reset function —
 * a full page load IS the reset. Navigating with page.goto() (a real load)
 * therefore gives each test a clean fixture backend.
 */
export async function resetFixtures(page: Page, path = "/links"): Promise<void> {
  await page.goto(path);
}
