import path from "node:path";
import { defineConfig, devices } from "@playwright/test";
import { webServerCommand } from "../support/web-server";

/* ============================================================
   L5 adversarial — config for e2e/adversarial/dom-xss.spec.ts only.

   #885 — the web server now runs the PRODUCTION bundle via the shared
   QA_PREBUILT_WEB switch (support/web-server.ts, #883), the same one
   playwright.journeys.config.ts and playwright.a11y.config.ts use, instead of
   `next dev`. Dev mode is NOT a safe surface for a stored-XSS oracle: it serves
   unminified code with React dev-only warnings and different hydration timing,
   so a check of what a real visitor's browser executes must run the same
   production `next start` bundle visitors get. QA_PREBUILT_WEB=1 (CI builds web
   as its own step first) → `next start` only; unset (a bare local run) →
   `next build && next start`, so a fresh checkout still serves a production
   bundle with no extra step. The NEXT_PUBLIC_* values are prefixed inline so the
   build and the start bake/read identical values. Playwright's own `webServer`
   manages that child's lifecycle (spawns and reaps it), so nothing here is a
   long-lived process left running in this shell.
   ============================================================ */

const PORT = Number(process.env.QA_WEB_PORT ?? 3000);
const BASE_URL = `http://localhost:${PORT}`;
const API_URL = process.env.QA_API_URL ?? "http://localhost:3001/api/v1";

const RUN_DIR = process.env.QA_RUN_DIR ?? path.resolve(__dirname, "../../.qa-runs/adversarial-local");
const ARTIFACTS = path.join(RUN_DIR, "artifacts");

export default defineConfig({
  testDir: __dirname,
  fullyParallel: false,
  forbidOnly: !!process.env.CI,
  retries: 0,
  workers: 1,
  reporter: [
    ["list"],
    ["json", { outputFile: path.join(ARTIFACTS, "dom-xss.json") }],
  ],
  outputDir: path.join(ARTIFACTS, "dom-xss-test-results"),
  timeout: 30_000,
  use: {
    baseURL: BASE_URL,
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
  },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
  webServer: {
    command: webServerCommand({
      port: PORT,
      env: [
        "NEXT_PUBLIC_USE_FIXTURES=false",
        `NEXT_PUBLIC_API_URL=${API_URL}`,
        "SNAPURL_ALLOW_UNCONFIGURED_BUILD=true",
      ],
    }),
    url: BASE_URL,
    reuseExistingServer: process.env.QA_REUSE_SERVER === "1",
    // A production build can take ~2-3 min on a cold checkout; match the other
    // real-stack configs' 300s webServer budget.
    timeout: 300_000,
    env: {
      NEXT_PUBLIC_USE_FIXTURES: "false",
      NEXT_PUBLIC_API_URL: API_URL,
      SNAPURL_ALLOW_UNCONFIGURED_BUILD: "true",
    },
  },
});
