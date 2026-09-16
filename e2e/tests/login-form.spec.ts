import { expect, test } from "@playwright/test";
import { REAL_BACKEND } from "../support/real-session";
import { FIXTURE_LOGIN_PASSWORD, makeEmail, RUN_PASSWORD, registerAccount } from "../support/unique-identity";

/* E2E journey: the real login FORM. Unlike the other journeys, this deliberately
   does NOT seed a session — it drives the actual email+password form, exercising
   the login form, client-side auth token storage, and the route guard that the
   foundation test seeds past.

   Fixtures mode: /auth/login requires FIXTURE_LOGIN_PASSWORD (the fixture fake
   now rejects wrong passwords — #445 fixture-fidelity fix). A valid-shaped email
   + FIXTURE_LOGIN_PASSWORD signs in; anything else is rejected. This means the
   wrong-password test below exercises a real error path even in fixtures mode.

   (A true 2FA-login journey is not possible yet — the login page has no TOTP
   challenge step; that gap is tracked in issue #377.) */

/* Idempotency (issue #440): email is per-run unique so the account never exists
   from a previous run. Password:
   - Fixtures lane: FIXTURE_LOGIN_PASSWORD (the only password the fake accepts).
   - Real lane:     RUN_PASSWORD (per-run random, satisfies the 12-char minimum).
   In fixtures mode registerAccount() is NOT called — the fake accepts any
   well-formed email. In real-stack mode a beforeAll creates the account. */
const LOGIN_EMAIL = makeEmail("login");
// Resolved lazily: REAL_BACKEND is set by installRealSession() in the real-stack
// config before any test runs, but module-scope evaluation happens at load time.
// Using a getter keeps the reference live so it picks up the correct value.
// (#445 fixture-fidelity fix)
function loginPassword(): string {
  return REAL_BACKEND ? RUN_PASSWORD : FIXTURE_LOGIN_PASSWORD;
}

test.describe("login form", () => {
  test.beforeAll(async () => {
    // Only register the account when talking to the real backend.
    // In fixtures mode this is a no-op: the in-memory fake accepts any creds.
    //
    // With fullyParallel:true, Playwright re-runs beforeAll for each test
    // dispatched from this describe block to a worker. Guard against the
    // resulting 409 ("account already exists") by treating it as success —
    // the account is present and ready to use, which is all beforeAll needs.
    if (REAL_BACKEND) {
      try {
        await registerAccount(LOGIN_EMAIL, loginPassword());
      } catch (e: unknown) {
        // 409 means the account was already registered (e.g. by another worker's
        // beforeAll invocation in this same run). That is fine — the account
        // exists with the correct password. Re-throw anything else.
        if (!(e instanceof Error) || !e.message.includes("409")) throw e;
      }
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
    await password.fill(loginPassword());
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

/* Wrong-password test: exercises the credential-rejection path.
   Kept outside the "login form" describe so it does not share the beforeAll
   that registers LOGIN_EMAIL. With fullyParallel:true, Playwright re-runs
   beforeAll for each test group dispatched to a worker; a second registration
   attempt for the same email would throw 409 and kill the test. This test
   needs no pre-existing account — it only needs the API or fake to reject
   an incorrect password.

   Fixtures lane: the fake now rejects any password != FIXTURE_LOGIN_PASSWORD
   (#445 fixture-fidelity fix). Real lane: the API returns 401/403.
   Oracle: the login page stays visible and no authenticated shell renders.

   IMPORTANT: assertion order matters for mutation-resistance. We wait for the
   authenticated dashboard button to have count(0) with a full expect-timeout —
   this forces a 10-second wait that would catch a successful login (the button
   would appear within ~2s of navigation). Only after that do we assert the URL.
   A test that asserts the URL before navigation completes would be a green
   lie on a broken fixture. */
test("login form — a correct email with the wrong password shows a credential error and does not sign in", async ({
  page,
}) => {
  await page.goto("/login");

  // Generate a fresh throwaway email inside the test body so it is guaranteed
  // unique per test invocation, regardless of worker count or run frequency.
  // No registration needed: the wrong-password path fires for any valid-shaped email.
  const throwawayEmail = `e2e-wrongpw-${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}@example.com`;
  await page.getByPlaceholder("you@company.com").fill(throwawayEmail);
  await page.getByPlaceholder("••••••••").fill("this-is-the-wrong-password-9z");
  await page.getByRole("button", { name: "Sign in" }).click();

  // The fixture must reject the wrong password and surface an error message.
  // Asserting the error paragraph (rendered by login.isError) is the reliable
  // oracle here: it only renders when the API/fixture throws, meaning the user
  // was NOT signed in. A mutant fixture that accepts any password would NOT
  // render this paragraph — it would navigate to /links instead — so this
  // assertion goes RED on the mutant. (#445 mutation-proof)
  await expect(page.getByText(/invalid credentials/i)).toBeVisible();
  // Belt-and-suspenders: must stay on /login — no navigation to the dashboard.
  await expect(page).toHaveURL(/\/login$/);
  // The authenticated shell must NOT appear.
  await expect(page.getByRole("button", { name: /New link|Create a link/ })).toHaveCount(0);
});
