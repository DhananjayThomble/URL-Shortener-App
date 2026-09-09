import { expect, test } from "@playwright/test";

/* E2E journey: the real login FORM. Unlike the other journeys, this deliberately
   does NOT seed a session — it drives the actual email+password form, exercising
   the login form, client-side auth token storage, and the route guard that the
   foundation test seeds past. Fixtures mode: /auth/login returns a session for
   any credentials, so a valid-shaped email + any password signs in.

   (A true 2FA-login journey is not possible yet — the login page has no TOTP
   challenge step; that gap is tracked in issue #377.) */

test.describe("login form", () => {
  test("an unauthenticated user can sign in through the form and reach the dashboard", async ({ page }) => {
    await page.goto("/login");

    // The login form renders (email must be a valid shape per the zod resolver).
    const email = page.getByPlaceholder("you@company.com");
    const password = page.getByPlaceholder("••••••••");
    await expect(email).toBeVisible();
    await expect(password).toBeVisible();

    await email.fill("demo@snapurl.local");
    await password.fill("demo-password-1234");
    await page.getByRole("button", { name: "Sign in" }).click();

    // On success the app navigates to the dashboard link list.
    await expect(page).toHaveURL(/\/links$/);
    // And the authenticated shell is present (the create-link trigger only shows
    // once past the route guard).
    await expect(page.getByRole("button", { name: /New link|Create a link/ }).first()).toBeVisible();
  });

  test("an invalid email does not sign the user in", async ({ page }) => {
    await page.goto("/login");
    await page.getByPlaceholder("you@company.com").fill("not-an-email");
    await page.getByPlaceholder("••••••••").fill("whatever");
    await page.getByRole("button", { name: "Sign in" }).click();

    // Submission is blocked (native email validation and/or the zod resolver), so
    // the user stays on /login and never reaches the dashboard. Assert the real
    // invariant — no navigation — rather than which layer produced the message.
    await expect(page).toHaveURL(/\/login$/);
    await expect(page.getByRole("button", { name: /New link|Create a link/ })).toHaveCount(0);
  });
});
