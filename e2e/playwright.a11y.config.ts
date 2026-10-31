import path from "node:path";
import { defineConfig, devices } from "@playwright/test";
import { installRealSession } from "./support/real-session";
import { webServerCommand } from "./support/web-server";

/* ============================================================
   Issue #459 — a11y label/select-name audit against the REAL stack.

   Same real-backend wiring as playwright.real.config.ts (fixtures OFF, web built
   against the staging API, seedSession swapped for a real registered session),
   but scoped to e2e/a11y and without the entity-seed globalSetup — the label /
   select-name rules inspect rendered markup, which does not need seeded data.

   Requires a running staging stack (api :3001). Set QA_REUSE_SERVER=1 to adopt
   a web server you already built with NEXT_PUBLIC_USE_FIXTURES=false.

   Issue #884: the web server now comes from the shared QA_PREBUILT_WEB switch
   (support/web-server.ts, .kiro/specs/real-stack-ci/design.md §2), the same one
   #883 wired into playwright.journeys.config.ts. QA_PREBUILT_WEB=1 (CI runs
   `next build` as its own step first) → `next start` only; unset (a bare local
   run) → `next build && next start`, so a fresh checkout still serves a
   production bundle with no extra step. The NEXT_PUBLIC_* values are prefixed
   inline so build and start bake/read identical values.
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
    timeout: 300_000,
    env: {
      NEXT_PUBLIC_USE_FIXTURES: "false",
      NEXT_PUBLIC_API_URL: API_URL,
      SNAPURL_ALLOW_UNCONFIGURED_BUILD: "true",
    },
  },
});
