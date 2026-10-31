import { test } from "@playwright/test";
import { captureRoute, visualSuite } from "./_helpers";

/* ============================================================================
   Public baselines — issue #870 (3 routes).

   Public share pages, no session:
   - /p/spring-sale   — password-protected link preview
   - /f/spring-feedback — the live form (4 fields incl. select + textarea)
   - /b/acme          — the only fixture bio page with populated blocks

   fullPage: the form and the bio page are scroll documents whose below-fold
   content is not covered by another target, so they use fullPage; the link
   preview is a short card, viewport-clipped.
   ============================================================================ */

visualSuite("visual · public", () => {
  test("public /p/spring-sale", async ({ page }) => {
    await captureRoute(page, "/p/spring-sale", { name: "p-spring-sale" });
  });

  test("public /f/spring-feedback", async ({ page }) => {
    await captureRoute(page, "/f/spring-feedback", { name: "f-spring-feedback", fullPage: true });
  });

  test("public /b/acme", async ({ page }) => {
    await captureRoute(page, "/b/acme", { name: "b-acme", fullPage: true });
  });
});
