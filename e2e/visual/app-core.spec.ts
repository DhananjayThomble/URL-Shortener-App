import { test } from "@playwright/test";
import { captureRoute, visualSuite } from "./_helpers";

/* ============================================================================
   App baselines (core) — issue #870.

   Authenticated routes via seedSession() (authed:true). The (app)/layout.tsx
   has a transient "Booting" state ("Checking your session…") with no <main>;
   captureRoute waits for <main> to be visible, which clears it.

   /links/[id] uses lnk_spring — the richest fixture (3 routing rules, UTM
   block, social card, password-protected, tags, folder, expiry).

   Viewport-clipped by default (§870). These dashboard pages are data tables and
   cards whose meaningful state is above the fold at each viewport; the overflow
   table's scrolled state is captured as its own interactive target in
   states.spec.ts.
   ============================================================================ */

const ROUTES: Array<{ path: string; name: string }> = [
  { path: "/links", name: "links" },
  { path: "/links/lnk_spring", name: "links-detail" },
  { path: "/analytics", name: "analytics" },
  { path: "/conversions", name: "conversions" },
];

visualSuite("visual · app core", () => {
  for (const { path, name } of ROUTES) {
    test(`app ${name}`, async ({ page }) => {
      await captureRoute(page, path, { authed: true, name });
    });
  }
});
