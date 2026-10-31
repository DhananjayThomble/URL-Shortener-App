import { test } from "@playwright/test";
import { captureRoute, visualSuite } from "./_helpers";

/* ============================================================================
   Auth baselines — issue #870 (6 routes).

   /reset-password, /verify-email and /invite read a ?token= QUERY param (not a
   path segment) and fall back to "" when absent, which renders an "invalid
   link" state instead of the real form. A fixed non-empty token is passed so
   the baseline captures the actual form/flow, deterministically.

   Signed-out context (no seedSession). Viewport-clipped: auth cards are short
   and fully above the fold on every viewport, so fullPage buys nothing.
   ============================================================================ */

// A fixed, obviously-synthetic token. Its value never reaches a real backend
// (fixtures mode); it only has to be non-empty and stable so the rendered frame
// is identical on every run.
const TOKEN = "visual-fixed-token";

const ROUTES: Array<{ path: string; name: string }> = [
  { path: "/login", name: "login" },
  { path: "/register", name: "register" },
  { path: "/forgot-password", name: "forgot-password" },
  { path: `/reset-password?token=${TOKEN}`, name: "reset-password" },
  { path: `/verify-email?token=${TOKEN}`, name: "verify-email" },
  { path: `/invite?token=${TOKEN}`, name: "invite" },
];

visualSuite("visual · auth", () => {
  for (const { path, name } of ROUTES) {
    test(`auth ${name}`, async ({ page }) => {
      await captureRoute(page, path, { name });
    });
  }
});
