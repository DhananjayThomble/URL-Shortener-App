import { test } from "@playwright/test";
import { captureRoute, visualSuite } from "./_helpers";

/* ============================================================================
   Marketing baselines — issue #870 (7 signed-OUT routes).

   These render the signed-out chrome. globals.css:269-272 shows/hides control
   sets from the data-auth pre-paint hint; we never seed a session here, so the
   signed-out state is explicit (no seedSession call), not incidental.

   fullPage justification: marketing pages are long scroll documents whose
   below-fold content (feature sections, footer) is not covered by any other
   target, so these use fullPage. The legal pages (/privacy, /terms) are also
   full documents. This is the deliberate exception to the §870 viewport-clip
   default.
   ============================================================================ */

const ROUTES = [
  "/",
  "/product",
  "/pricing",
  "/self-host",
  "/for-developers",
  "/privacy",
  "/terms",
];

visualSuite("visual · marketing (signed out)", () => {
  for (const route of ROUTES) {
    test(`marketing ${route}`, async ({ page }) => {
      await captureRoute(page, route, { fullPage: true });
    });
  }
});
