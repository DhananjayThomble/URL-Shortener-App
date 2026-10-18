/**
 * Journey 794 — legal pages + one validation style on /register  @mobile
 *
 * Real stack. A visitor finds the Terms and Privacy pages from the register
 * form, sees they are placeholders, comes back, trips the malformed-email case
 * from the QA report ("qa-user1@") and gets the INLINE message (not the browser
 * bubble), fixes it and registers against the real API.
 *
 * Oracles: issue #794 acceptance criteria; the real POST /auth/register.
 */

import { expect, test } from "@playwright/test";
import { makeEmail, RUN_PASSWORD } from "./helpers";

const EMAIL_MSG = "That doesn't look like an email address";

test.describe("Journey 794 — legal pages and register validation", () => {
  test("register links to both placeholder legal pages, validates inline, then signs up @mobile", async ({ page }) => {
    let registerCalls = 0;
    page.on("request", (r) => {
      if (r.method() === "POST" && r.url().includes("/auth/register")) registerCalls += 1;
    });

    await page.goto("/register");

    for (const [name, heading] of [
      ["Terms of Service", "Terms of Service"],
      ["Privacy Policy", "Privacy Policy"],
    ] as const) {
      await page.getByRole("link", { name }).click();
      await expect(page.getByRole("heading", { level: 1, name: heading })).toBeVisible();
      await expect(page.getByTestId("legal-placeholder-banner")).toContainText("Placeholder");
      await page.goBack();
      await expect(page.getByRole("heading", { name: "Start free" })).toBeVisible();
    }

    await page.getByLabel("Name").fill("Journey Tester");
    const email = page.getByLabel("Email");
    await email.fill("qa-user1@");
    await page.getByLabel("Password").fill(RUN_PASSWORD);
    await page.getByRole("button", { name: "Create account" }).click();

    await expect(page.getByText(EMAIL_MSG)).toBeVisible();
    await expect(email).toHaveAttribute("aria-invalid", "true");
    expect(registerCalls).toBe(0);
    await expect(page).toHaveURL(/\/register/);

    await email.fill(makeEmail("j794"));
    await page.getByRole("button", { name: "Create account" }).click();
    await expect(page).toHaveURL(/\/links/, { timeout: 30_000 });
    expect(registerCalls).toBe(1);
  });

  test("marketing footer reaches both legal pages @mobile", async ({ page }) => {
    await page.goto("/pricing");
    for (const name of ["Terms of Service", "Privacy Policy"]) {
      await page.goto("/pricing");
      await page.getByRole("contentinfo").getByRole("link", { name }).click();
      await expect(page.getByRole("heading", { level: 1, name })).toBeVisible();
    }
  });
});
