import path from "node:path";
import { defineConfig, devices } from "@playwright/test";
import { installRealSession } from "./support/real-session";

/* ============================================================
   Issue #459 — a11y label/select-name audit against the REAL stack.

   Same real-backend wiring as playwright.real.config.ts (fixtures OFF, web built
   against the staging API, seedSession swapped for a real registered session),
   but scoped to e2e/a11y and without the entity-seed globalSetup — the label /
   select-name rules inspect rendered markup, which does not need seeded data.

   Requires a running staging stack (api :3001). Set QA_REUSE_SERVER=1 to adopt
   a web server you already built with NEXT_PUBLIC_USE_FIXTURES=false.
   ============================================================ */

installRealSession();

const PORT = Number(process.env.QA_WEB_PORT ?? 3000);
const BASE_URL = `http://localhost:${PORT}`;
const API_URL = process.env.QA_API_URL ?? "http://localhost:3001/api/v1";
const RUN_DIR = process.env.QA_RUN_DIR ?? path.resolve(__dirname, "../.qa-runs/a11y-459");
const ARTIFACTS = path.join(RUN_DIR, "artifacts");

export default defineConfig({
  testDir: "./a11y",
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: 0,
  workers: Number(process.env.QA_WORKERS ?? 3),
  reporter: [
    ["list"],
    ["json", { outputFile: path.join(ARTIFACTS, "a11y-459.json") }],
  ],
  outputDir: path.join(ARTIFACTS, "test-results"),
  timeout: 60_000,
  expect: { timeout: 10_000 },
  use: {
    baseURL: BASE_URL,
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
  },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
  webServer: {
    command: `pnpm --filter snapurl-web exec next build && pnpm --filter snapurl-web exec next start --port ${PORT}`,
    url: BASE_URL,
    reuseExistingServer: process.env.QA_REUSE_SERVER === "1",
    timeout: 300_000,
    env: {
      NEXT_PUBLIC_USE_FIXTURES: "false",
      NEXT_PUBLIC_API_URL: API_URL,
      SNAPURL_ALLOW_UNCONFIGURED_BUILD: "true",
    },
  },
});
