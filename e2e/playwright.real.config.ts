import path from "node:path";
import { defineConfig, devices } from "@playwright/test";
import { installRealSession } from "./support/real-session";
/* globalSetup: registers one shared workspace + seeds all entities the specs
   assert on. Must run before any test worker starts. See support/seed-real.ts.
   Playwright resolves the string path relative to the config file. */

/* ============================================================
   The SAME specs as playwright.config.ts, run against the REAL stack.

   playwright.config.ts serves web/ with NEXT_PUBLIC_USE_FIXTURES=true, which
   answers every API call from the in-memory fake in
   web/src/lib/api/fixtures.ts. Green there means "the UI renders against a
   fake" — it cannot see a backend, contract or business-logic bug.

   This config changes exactly two things and nothing else:
     1. the web app is built and served with fixtures OFF, pointed at the
        staging NestJS API;
     2. support/session.ts#seedSession is swapped for a helper that registers a
        real account and seeds the tokens the API issued (see support/
        real-session.ts).

   testDir, the specs, their assertions, the timeouts and the expect budget are
   identical to the fixtures config, so a per-test difference between the two
   runs is a difference in behaviour and not in test budget.

   Nothing in tests/ or support/session.ts is modified, and the fixtures config
   (the CI path) is untouched.

   Requires a running staging stack — api :3001, redirect :3002, postgres :5435
   (docker-compose.staging.yml). It never talks to production or to AWS.
   ============================================================ */

installRealSession();

/* Port 3000 — the same port playwright.config.ts uses, so the two runs must not
   overlap. That is not a free choice: the API's CORS allowlist is WEB_ORIGIN,
   which docker-compose.staging.yml defaults to http://localhost:3000. Serving
   the dashboard anywhere else means the browser gets no
   access-control-allow-origin header, every authenticated fetch fails in the
   browser (while the same request succeeds over curl), and the route guard
   bounces to /login — which would make every spec fail for one uniform reason
   and measure nothing. Override with QA_WEB_PORT only alongside WEB_ORIGIN. */
const PORT = Number(process.env.QA_WEB_PORT ?? 3000);
const BASE_URL = `http://localhost:${PORT}`;
const API_URL = process.env.QA_API_URL ?? "http://localhost:3001/api/v1";

/* Raw artifacts (traces, screenshots, reporter output) stay out of git:
   .qa-runs/ is gitignored. */
const RUN_DIR = process.env.QA_RUN_DIR ?? path.resolve(__dirname, "../.qa-runs/real-stack");
const ARTIFACTS = path.join(RUN_DIR, "artifacts");

export default defineConfig({
  testDir: "./tests",
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  /* No retries: a retry would hide an intermittent real-stack failure, and this
     run exists to measure failures, not to get to green. */
  retries: 0,
  workers: Number(process.env.QA_WORKERS ?? 2),
  globalSetup: "./support/seed-real",
  reporter: [
    ["list"],
    ["json", { outputFile: path.join(ARTIFACTS, "real-stack.json") }],
    ["html", { outputFolder: path.join(ARTIFACTS, "html"), open: "never" }],
  ],
  outputDir: path.join(ARTIFACTS, "test-results"),
  /* Same budgets as playwright.config.ts. */
  timeout: 30_000,
  expect: { timeout: 10_000 },
  use: {
    baseURL: BASE_URL,
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
    video: "retain-on-failure",
  },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
  webServer: {
    /* Fixtures off. NEXT_PUBLIC_* is inlined at build time, so the build has to
       happen with this environment — pointing an existing fixtures build at the
       API is not possible.

       web/next.config.ts refuses a production build whose NEXT_PUBLIC_API_URL is
       a localhost address, because shipping that to real browsers makes every
       visitor call their own machine. SNAPURL_ALLOW_UNCONFIGURED_BUILD is the
       named escape hatch for a build nobody deploys, which is what this is. */
    command: `pnpm --filter snapurl-web exec next build && pnpm --filter snapurl-web exec next start --port ${PORT}`,
    url: BASE_URL,
    /* reuseExistingServer: adopt an already-running server when QA_REUSE_SERVER=1.
       The default is false (never adopt) to prevent accidentally using the
       fixtures build. Set QA_REUSE_SERVER=1 only when you know the running
       server was built with NEXT_PUBLIC_USE_FIXTURES=false. */
    reuseExistingServer: process.env.QA_REUSE_SERVER === "1",
    timeout: 300_000,
    env: {
      NEXT_PUBLIC_USE_FIXTURES: "false",
      NEXT_PUBLIC_API_URL: API_URL,
      SNAPURL_ALLOW_UNCONFIGURED_BUILD: "true",
    },
  },
});
