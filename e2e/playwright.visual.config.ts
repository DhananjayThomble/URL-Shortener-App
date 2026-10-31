import { defineConfig, devices } from "@playwright/test";

/* ============================================================================
   Visual-regression lane — issues #869 (harness) and #870 (phase-1 baselines).
   Design: .kiro/specs/visual-regression/design.md §6 (this config), §2 (the
   nondeterminism inventory the `use` options defend).

   A fifth Playwright lane parallel to the four that exist (fixtures,
   mocked-api, journeys, a11y). Everything lives under e2e/ so the `non_e2e`
   path filter (verify.yml) keeps an e2e-only PR out of coverage-delta.

   #869 brought the lane up with one smoke target and no baselines. #870 adds
   the phase-1 baseline set: 28 route targets × 3 Chromium viewports plus the
   interactive-state targets, generated through the digest-pinned container
   (scripts/visual-baselines.sh) and committed under visual/__screenshots__.

   The three active viewports are pinned to the breakpoints that actually change
   layout (issue #870): mobile 390×844 (below Tailwind `sm` 640px, touch
   context), tablet 768×1024 (between `sm` and `lg` 1024px), desktop 1440×900
   (above `lg`). The `lg`/1024px boundary is the sidebar↔MobileNav swap and the
   44px tap-target growth; `sm`/640px is the topbar search / create / footer
   stacking line.
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
  // The three active Chromium viewports (issue #870). desktop-dark and webkit
  // are deliberately NOT in this list: they belong to a later phase (T7), need a
  // WebKit browser the Chromium lane does not install, and would otherwise match
  // the marketing/auth/public spec filenames and generate out-of-scope baselines.
  // They are documented in EXTRA_PROJECTS below and only added when
  // VISUAL_EXTRA_PROJECTS=1, so the default lane is exactly the 3 Chromium shots.
  projects: [
    {
      name: "desktop",
      use: { ...devices["Desktop Chrome"], viewport: { width: 1440, height: 900 }, colorScheme: "light" },
    },
    {
      name: "tablet",
      use: { ...devices["Desktop Chrome"], viewport: { width: 768, height: 1024 }, colorScheme: "light" },
    },
    // Mobile is a TOUCH context (Pixel 7 device descriptor → hasTouch/isMobile),
    // which covers design §2 row #15 (row-action opacity:1 under
    // @media (hover: none) — different pixels from the same code). The viewport
    // is pinned to 390×844 per issue #870 (below Tailwind `sm` 640px), overriding
    // the Pixel 7 default so the baseline width is the documented breakpoint, not
    // a device-descriptor quirk.
    {
      name: "mobile",
      use: { ...devices["Pixel 7"], viewport: { width: 390, height: 844 }, colorScheme: "light" },
    },
    // T7 projects, inert by default. Enabled only with VISUAL_EXTRA_PROJECTS=1.
    ...(process.env.VISUAL_EXTRA_PROJECTS === "1"
      ? [
          {
            name: "desktop-dark",
            use: {
              ...devices["Desktop Chrome"],
              viewport: { width: 1440, height: 900 },
              colorScheme: "dark" as const,
            },
            testMatch: /(marketing|app-links|app-analytics)/,
          },
          {
            name: "webkit",
            use: {
              ...devices["Desktop Safari"],
              viewport: { width: 1440, height: 900 },
              colorScheme: "light" as const,
            },
            testMatch: /(marketing|auth|app-links|app-team|public)/,
          },
        ]
      : []),
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
