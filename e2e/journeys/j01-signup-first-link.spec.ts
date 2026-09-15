/**
 * Journey 1 — Sign up → first link  @mobile
 *
 * A brand new user registers, lands on the dashboard, creates a link, sees
 * it listed, and follows the short URL on :3002 to land on the destination.
 *
 * Oracles:
 *   - packages/contract/src/auth.ts   — RegisterInput, AuthSession
 *   - packages/contract/src/link.ts   — CreateLinkInput, Link
 *   - Invariant: the redirect service on :3002 must follow an active link
 *     to its destination URL.
 *
 * Selectors derived from web/src/app/(auth)/register/page.tsx:
 *   placeholder="Priya Raman" | "you@company.com" | "••••••••"
 *   button "Create account"
 */

import { expect, test } from "@playwright/test";
import { makeEmail, RUN_PASSWORD, REDIRECT_URL } from "./helpers";

const DESTINATION = "https://example.com/j1-landing";

test.describe("Journey 1 — Sign up → first link", () => {
  test("desktop: register, create a link, follow the redirect @mobile", async ({ page }) => {
    const email = makeEmail("j1-desk");

    /* ---- 1. Register via the sign-up form ---- */
    await page.goto("/register");
    await expect(page).toHaveURL(/\/register/);

    // Placeholders from register/page.tsx
    await page.getByPlaceholder("Priya Raman").fill("Journey Tester");
    await page.getByPlaceholder("you@company.com").fill(email);
    await page.getByPlaceholder("••••••••").fill(RUN_PASSWORD);
    await page.getByRole("button", { name: "Create account" }).click();

    /* After registration the app navigates to /links */
    await expect(page).toHaveURL(/\/links/, { timeout: 30_000 });

    /* ---- 2. Create a link ---- */
    const slug = `j1-${Date.now().toString(36)}`;

    await page
      .getByRole("button", { name: /New link|Create a link/i })
      .first()
      .click();

    const drawer = page.getByRole("dialog", { name: /create a link/i });
    await expect(drawer).toBeVisible();

    // Placeholders from create-link-drawer.tsx
    await drawer.getByPlaceholder(/https:\/\/acme\.com|destination/i).fill(DESTINATION);
    await drawer.getByPlaceholder(/spring.sale|slug|back.half/i).fill(slug);
    await drawer.getByRole("button", { name: /create link/i }).click();

    await expect(drawer).toBeHidden({ timeout: 15_000 });

    /* ---- 3. The new link appears in the list ---- */
    // The copy button has aria-label "Copy short link <domain>/<slug>"
    const copyBtn = page.getByRole("button", { name: new RegExp(`Copy short link .+/${slug}`) });
    await expect(copyBtn).toBeVisible({ timeout: 15_000 });

    /* Read the short URL from the copy button's aria-label.
       Format (issue #352): "Copy short link <domain>/<slug>" */
    const copyLabel =
      (await copyBtn.getAttribute("aria-label")) ??
      (await copyBtn.textContent()) ??
      "";
    // Extract the host/path portion: everything after "Copy short link "
    const afterPrefix = copyLabel.replace(/^Copy short link\s+/, "").trim();
    const shortUrl = afterPrefix.startsWith("http")
      ? afterPrefix
      : `http://${afterPrefix}`;

    /* ---- 4. Follow the redirect on :3002 ---- */
    const redirectPage = await page.context().newPage();
    await redirectPage.goto(shortUrl, { waitUntil: "commit", timeout: 15_000 });

    /* Invariant: an active link must reach its destination */
    const finalUrl = redirectPage.url();
    expect(finalUrl, "Redirect should land on the destination domain").toContain("example.com");
    await redirectPage.close();
  });
});
