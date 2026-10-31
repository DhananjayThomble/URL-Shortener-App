import { defineConfig, devices } from "@playwright/test";

/* ============================================================================
   Visual-regression lane — issue #869.
   Design: .kiro/specs/visual-regression/design.md §6 (this config), §2 (the
   nondeterminism inventory the `use` options defend).

   A fifth Playwright lane parallel to the four that exist (fixtures,
   mocked-api, journeys, a11y). Everything lives under e2e/ so the `non_e2e`
   path filter (verify.yml) keeps an e2e-only PR out of coverage-delta.

   This PR brings up the lane with ONE smoke target only and NO committed
   baselines — baselines are issue #870. The smoke spec captures a screenshot to
   a buffer and asserts the capture path works (see visual/home-smoke.spec.ts);
   it does not compare against a __screenshots__ baseline, so it runs green on a
   fresh checkout and proves the harness + container end to end.
   ============================================================================ */

const PORT = Number(process.env.VISUAL_PORT ?? 3100); // NOT 3000 — the fixtures and
// mocked-api lanes already share 3000 and cannot run concurrently with each other.
const BASE_URL = `http://localhost:${PORT}`;

export default defineConfig({
  testDir: "./visual",
  // Baselines (issue #870) will land under here, per project. No baseline is
  // committed in this PR.
  snapshotPathTemplate: "{testDir}/__screenshots__/{projectName}/{testFileName}/{arg}{ext}",
  fullyParallel: false,
  retries: 0, // a visual failure is a finding, never retried away (design §6)
  workers: 1,
  forbidOnly: !!process.env.CI,
  reporter: process.env.CI
    ? [["html", { open: "never", outputFolder: "playwright-report-visual" }], ["list"]]
    : "list",
  use: {
    baseURL: BASE_URL,
    locale: "en-US", // design §2 rows #5, #6 — formatDate / toLocaleString follow runner locale
    timezoneId: "UTC", // design §2 row #5 — formatDate parse is TZ-sensitive
    reducedMotion: "reduce", // design §2 row #9 (with the §4 chart change)
    deviceScaleFactor: 1,
  },
  expect: {
    toHaveScreenshot: {
      animations: "disabled", // design §2 row #12 — Playwright fast-forwards CSS animations
      caret: "hide",
      scale: "css",
      stylePath: "./visual/screenshot.css", // hides scrollbars (design §2 row #20)
      // Starting point from design §6. The real no-op diff-pixel count is
      // measured during #870's baseline bring-up and this is tuned just above
      // it — never raised to silence a genuine diff. No baseline is compared in
      // this PR, so this value is not yet exercised.
      maxDiffPixelRatio: 0.002,
    },
  },
  projects: [
    {
      name: "desktop",
      use: { ...devices["Desktop Chrome"], viewport: { width: 1440, height: 900 }, colorScheme: "light" },
    },
    {
      name: "tablet",
      use: { ...devices["Desktop Chrome"], viewport: { width: 768, height: 1024 }, colorScheme: "light" },
    },
    // Pixel 7 is a touch context, which covers design §2 row #15 (row-action
    // opacity under @media (hover: none)).
    { name: "mobile", use: { ...devices["Pixel 7"], colorScheme: "light" } },
    // desktop-dark and webkit carry testMatch subsets and are left disabled
    // until a later phase (T7) — no spec here matches them, so they are inert.
    {
      name: "desktop-dark",
      use: { ...devices["Desktop Chrome"], viewport: { width: 1440, height: 900 }, colorScheme: "dark" },
      testMatch: /(marketing|app-links|app-analytics)/,
    },
    {
      name: "webkit",
      use: { ...devices["Desktop Safari"], viewport: { width: 1440, height: 900 }, colorScheme: "light" },
      testMatch: /(marketing|auth|app-links|app-team|public)/,
    },
  ],
  webServer: {
    command: `pnpm --filter snapurl-web exec next build && pnpm --filter snapurl-web exec next start --port ${PORT}`,
    url: BASE_URL,
    // Never adopt a running server in CI: it may be a different build and would
    // make the smoke pass or fail for the wrong reason.
    reuseExistingServer: !process.env.CI,
    timeout: 300_000, // includes a full Next.js production build
    env: {
      NEXT_PUBLIC_USE_FIXTURES: "true",
      SNAPURL_ALLOW_UNCONFIGURED_BUILD: "true",
    },
  },
});
