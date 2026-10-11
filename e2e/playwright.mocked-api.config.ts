import { defineConfig, devices } from "@playwright/test";

/* E2E lane for behaviour that lives in the REAL API client (web/src/lib/api/client.ts)
   and therefore cannot be seen in fixtures mode: with NEXT_PUBLIC_USE_FIXTURES=true
   every call is answered in-process by web/src/lib/api/fixtures.ts and the client's
   fetch / 401 / refresh code never runs.

   Here the web app is built with fixtures OFF and pointed at its OWN origin
   (http://localhost:3000/api/v1). No API process is started and none is needed:
   each spec intercepts /api/v1/** in the browser with page.route (see
   support/mock-api.ts) and answers with the same status codes and messages the
   NestJS API sends. The browser, the Next app, the React Query layer and the API
   client are all real. Same origin means no CORS; nothing leaves the machine and
   it never touches the staging stack (ports 3001/3002/5435).

   Same port, budgets and server shape as playwright.config.ts, so the two lanes
   must run one after the other (CI does). */

const PORT = 3000;
const BASE_URL = `http://localhost:${PORT}`;

export default defineConfig({
  testDir: "./mocked-api",
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  workers: process.env.CI ? 1 : undefined,
  reporter: process.env.CI
    ? [["html", { open: "never", outputFolder: "playwright-report-mocked-api" }], ["list"]]
    : "list",
  timeout: 30_000,
  expect: { timeout: 10_000 },
  use: { baseURL: BASE_URL, trace: "on-first-retry" },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
  webServer: {
    command: `pnpm --filter snapurl-web exec next build && pnpm --filter snapurl-web exec next start --port ${PORT}`,
    url: BASE_URL,
    // Never adopt a running server: it may be a fixtures build, which would make
    // these specs pass or fail for the wrong reason.
    reuseExistingServer: false,
    timeout: 300_000,
    env: {
      NEXT_PUBLIC_USE_FIXTURES: "false",
      NEXT_PUBLIC_API_URL: `${BASE_URL}/api/v1`,
      SNAPURL_ALLOW_UNCONFIGURED_BUILD: "true",
    },
  },
});
