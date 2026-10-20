import { defineConfig, devices } from "@playwright/test";

/* #810 — LOCAL WebKit (iPhone 15) evidence lane.
 *
 * The bug only reproduces on iOS Safari / WebKit: the native <select> dropdown
 * in the Bulk create panel is unreadable in dark theme (light-grey background,
 * near-white text) because the stylesheet declared no `color-scheme`. Chromium
 * (Pixel 7) dark is unaffected, so this cannot be seen in the chromium-only CI
 * lanes (see the note in playwright.mocked-api.config.ts: "iPhone 15 on WebKit
 * is local evidence").
 *
 * This config is therefore NOT wired into CI (verify.yml installs chromium
 * only). Run it locally with WebKit installed:
 *   pnpm --filter snapurl-e2e exec playwright install webkit
 *   pnpm --filter snapurl-e2e exec playwright test -c playwright.webkit.config.ts
 *
 * Same real-client / browser-mocked-API shape as the mocked-api lane: the web
 * app is built with fixtures OFF against its own origin, and the spec answers
 * /api/v1/** in the browser with page.route (support/mock-api.ts). */

const PORT = Number(process.env.WEBKIT_PORT ?? 3100);
const BASE_URL = `http://localhost:${PORT}`;

export default defineConfig({
  testDir: "./webkit",
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: 0,
  reporter: "list",
  timeout: 60_000,
  expect: { timeout: 10_000 },
  use: { baseURL: BASE_URL, trace: "on-first-retry" },
  projects: [{ name: "iphone-15-webkit", use: { ...devices["iPhone 15"] } }],
  webServer: {
    command: `pnpm --filter snapurl-web exec next build && pnpm --filter snapurl-web exec next start --port ${PORT}`,
    url: BASE_URL,
    reuseExistingServer: false,
    timeout: 300_000,
    env: {
      NEXT_PUBLIC_USE_FIXTURES: "false",
      NEXT_PUBLIC_API_URL: `${BASE_URL}/api/v1`,
      SNAPURL_ALLOW_UNCONFIGURED_BUILD: "true",
    },
  },
});
