import { defineConfig, devices } from "@playwright/test";

/* E2E for issue #353. The dashboard runs in FIXTURES mode: NEXT_PUBLIC_USE_FIXTURES=true
   routes every API call to web/src/lib/api/fixtures.ts (a module-level in-memory fake),
   so no API or database is needed. next.config.ts refuses a production build with
   fixtures on unless SNAPURL_ALLOW_UNCONFIGURED_BUILD=true is ALSO set — CI sets both.
   We build once and serve with `next start` (NOT `next dev`: dev's lazy per-route
   compile is a documented flake source). */

const PORT = 3000;
const BASE_URL = `http://localhost:${PORT}`;
const FIXTURE_ENV = { NEXT_PUBLIC_USE_FIXTURES: "true", SNAPURL_ALLOW_UNCONFIGURED_BUILD: "true" };

export default defineConfig({
  testDir: "./tests",
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  workers: process.env.CI ? 1 : undefined,
  reporter: process.env.CI ? [["html", { open: "never" }], ["list"]] : "list",
  timeout: 30_000,
  expect: { timeout: 10_000 },
  use: {
    baseURL: BASE_URL,
    trace: "on-first-retry",
  },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
  webServer: {
    // Build the web app under fixtures, then serve the production build.
    command: `pnpm --filter snapurl-web exec next build && pnpm --filter snapurl-web exec next start --port ${PORT}`,
    url: BASE_URL,
    reuseExistingServer: !process.env.CI,
    timeout: 180_000,
    env: FIXTURE_ENV,
  },
});
