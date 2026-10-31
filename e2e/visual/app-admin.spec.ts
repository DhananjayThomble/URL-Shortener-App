import { test } from "@playwright/test";
import { captureRoute, visualSuite } from "./_helpers";

/* ============================================================================
   App baselines (admin) — issue #870.

   Authenticated routes via seedSession(): team, developers, settings, reports.
   Viewport-clipped by default (§870).
   ============================================================================ */

const ROUTES: Array<{ path: string; name: string }> = [
  { path: "/team", name: "team" },
  { path: "/developers", name: "developers" },
  { path: "/settings", name: "settings" },
  { path: "/reports", name: "reports" },
];

visualSuite("visual · app admin", () => {
  for (const { path, name } of ROUTES) {
    test(`app ${name}`, async ({ page }) => {
      await captureRoute(page, path, { authed: true, name });
    });
  }
});
