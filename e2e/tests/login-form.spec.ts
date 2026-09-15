import { expect, test } from "@playwright/test";
import { REAL_BACKEND } from "../support/real-session";
import { makeEmail, RUN_PASSWORD, registerAccount } from "../support/unique-identity";

/* E2E journey: the real login FORM. Unlike the other journeys, this deliberately
   does NOT seed a session — it drives the actual email+password form, exercising
   the login form, client-side auth token storage, and the route guard that the
   foundation test seeds past. Fixtures mode: /auth/login returns a session for
   any credentials, so a valid-shaped email + any password signs in.

   (A true 2FA-login journey is not possible yet — the login page has no TOTP
   challenge step; that gap is tracked in issue #377.) */

/* Idempotency (issue #440): email and password are per-run unique so the account
   never exists from a previous run. In fixtures mode registerAccount() is NOT
   called — the fake accepts any credentials. In real-stack mode a beforeAll
   creates the account before the sign-in test tries to use it. */
const LOGIN_EMAIL = makeEmail("login");
const LOGIN_PASSWORD = RUN_PASSWORD;

test.describe("login form", () => {
  test.beforeAll(async () => {
    // Only register the account when talking to the real backend.
    // In fixtures mode this is a no-op: the in-memory fake accepts any creds.
    if (REAL_BACKEND) {
      await registerAccount(LOGIN_EMAIL, LOGIN_PASSWORD);
    }
  });

  test("an unauthenticated user can sign in through the form and reach the dashboard", async ({ page }) => {
    await page.goto("/login");

    // The login form renders (email must be a valid shape per the zod resolver).
    const email = page.getByPlaceholder("you@company.com");
    const password = page.getByPlaceholder("••••••••");
    await expect(email).toBeVisible();
    await expect(password).toBeVisible();

    await email.fill(LOGIN_EMAIL);
    await password.fill(LOGIN_PASSWORD);
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
