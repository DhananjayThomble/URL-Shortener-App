import { test } from "@playwright/test";
import { captureRoute, visualSuite } from "./_helpers";

/* ============================================================================
   App baselines (tools) — issue #870.

   Authenticated routes via seedSession(). /qr renders the QR panel whose SVG
   composes asynchronously; stabilise() waits for the composed <svg> to be
   visible before capture (design §2 row #21). /bio renders the bio editor.

   Viewport-clipped by default (§870).
   ============================================================================ */

const ROUTES: Array<{ path: string; name: string }> = [
  { path: "/qr", name: "qr" },
  { path: "/bio", name: "bio" },
  { path: "/forms", name: "forms" },
  { path: "/domains", name: "domains" },
];

visualSuite("visual · app tools", () => {
  for (const { path, name } of ROUTES) {
    test(`app ${name}`, async ({ page }) => {
      await captureRoute(page, path, { authed: true, name });
    });
  }
});
