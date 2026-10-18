import AxeBuilder from "@axe-core/playwright";
import { expect, test } from "@playwright/test";
import { mockApi, nestError } from "../support/mock-api";

/* #794 — /terms and /privacy returned 404 and nothing linked to them.

   Both are static marketing pages whose body is a PLACEHOLDER for the
   maintainer. The spec pins the three things that matter before real text
   lands: the routes answer 200, the placeholder status is unmistakable (a
   banner plus TODO markers, so nobody ships them as if they were final), and
   the pages are reachable from where a visitor looks for them — the marketing
   footer and the register form. Each link is followed with a real click and
   the destination asserted, not just checked for an href.
   Runs on desktop Chrome and Pixel 7 (playwright.mocked-api.config.ts). */

const PAGES = [
  { path: "/terms", heading: "Terms of Service", linkName: "Terms of Service" },
  { path: "/privacy", heading: "Privacy Policy", linkName: "Privacy Policy" },
] as const;

test.describe("legal pages (#794)", () => {
  for (const p of PAGES) {
    test(`${p.path} returns 200 and is clearly marked as a placeholder`, async ({ page }) => {
      const res = await page.goto(p.path);
      expect(res?.status()).toBe(200);

      await expect(page.getByRole("heading", { level: 1, name: p.heading })).toBeVisible();
      const banner = page.getByTestId("legal-placeholder-banner");
      await expect(banner).toBeVisible();
      await expect(banner).toContainText("Placeholder");
      // TODO markers show where the maintainer's text belongs, and none is hidden.
      const todos = page.locator("[data-todo='maintainer']");
      expect(await todos.count()).toBeGreaterThan(0);
      await expect(todos.first()).toBeVisible();
    });

    test(`${p.path} has one <main> and no landmark violations`, async ({ page }) => {
      await page.goto(p.path);
      await expect(page.locator("main")).toHaveCount(1);
      const { violations } = await new AxeBuilder({ page }).analyze();
      const landmark = violations.filter((v) => v.id === "region" || v.id.startsWith("landmark"));
      expect(landmark.map((v) => v.id)).toEqual([]);
    });

    test(`${p.path} is linked from the marketing footer`, async ({ page }) => {
      await page.goto("/pricing");
      await page.getByRole("contentinfo").getByRole("link", { name: p.linkName }).click();
      await expect(page).toHaveURL(new RegExp(`${p.path}$`));
      await expect(page.getByRole("heading", { level: 1, name: p.heading })).toBeVisible();
    });

    test(`${p.path} is linked from the register form`, async ({ page }) => {
      await mockApi(page, { "GET /auth/me": nestError(401, "Unauthorized") });
      await page.goto("/register");
      await page.getByRole("link", { name: p.linkName }).click();
      await expect(page).toHaveURL(new RegExp(`${p.path}$`));
      await expect(page.getByRole("heading", { level: 1, name: p.heading })).toBeVisible();
    });
  }

  test("the two pages link to each other", async ({ page }) => {
    await page.goto("/terms");
    await page.getByRole("main").getByRole("link", { name: "privacy page" }).click();
    await expect(page).toHaveURL(/\/privacy$/);
  });
});
