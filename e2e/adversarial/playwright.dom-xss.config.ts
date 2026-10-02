import path from "node:path";
import { defineConfig, devices } from "@playwright/test";

/* ============================================================
   L5 adversarial — config for e2e/adversarial/dom-xss.spec.ts only.

   Deliberately separate from e2e/playwright.real.config.ts: that config
   builds a PRODUCTION bundle (next build && next start), which takes ~2-3
   minutes and enforces the non-localhost NEXT_PUBLIC_API_URL guard in
   web/next.config.ts. This one-off adversarial DOM check needs neither — dev
   mode starts in seconds and has no such guard, and session-hygiene steering
   says not to hand-start a long-lived server from the agent's own shell.
   Playwright's own `webServer` option manages that lifecycle (spawns and
   reaps the child itself), so nothing here is a long-lived process left
   running in this shell.

   Never used in CI; invoked only from this issue's QA run.
   ============================================================ */

const PORT = Number(process.env.QA_WEB_PORT ?? 3000);
const BASE_URL = `http://localhost:${PORT}`;
const API_URL = process.env.QA_API_URL ?? "http://localhost:3001/api/v1";

const RUN_DIR = process.env.QA_RUN_DIR ?? path.resolve(__dirname, "../../.qa-runs/adversarial-local");
const ARTIFACTS = path.join(RUN_DIR, "artifacts");

export default defineConfig({
  testDir: __dirname,
  fullyParallel: false,
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
    command: `pnpm --filter snapurl-web exec next dev --port ${PORT}`,
    url: BASE_URL,
    reuseExistingServer: process.env.QA_REUSE_SERVER === "1",
    timeout: 120_000,
    env: {
      NEXT_PUBLIC_USE_FIXTURES: "false",
      NEXT_PUBLIC_API_URL: API_URL,
    },
  },
});
