import { expect, test } from "@playwright/test";
import { makeEmail, RUN_PASSWORD } from "../support/unique-identity";

/* E2E journey: the register / sign-up FORM at /(auth)/register. Like the login
   journey this is UNauthenticated — it does NOT seed a session, it drives the
   real name+email+password form, the useRegister mutation, client-side token
   storage, and the post-signup redirect the route guard depends on.

   Fixtures mode (no API/DB): POST /auth/register returns the fixture SESSION for
   any well-formed input (web/src/lib/api/fixtures.ts), so a valid name + a
   valid-shaped email + a ≥12-char password creates the account and lands on the
   dashboard. Selectors are accessible names / placeholders only (getByRole /
   getByPlaceholder) — no CSS, no data-testid. The Field label is not
   programmatically associated with its input, so — as in login-form.spec.ts —
   the inputs are addressed by their placeholders.

   Idempotency (issue #440): email and password are per-run unique so repeated
   real-stack runs do not collide on an already-registered address. The fixtures
   fake accepts any well-formed input, so unique values are harmless there. */

/* Per-run unique identity — different on every run so POST /auth/register
   never hits an already-taken email on the real backend. */
const REGISTER_EMAIL = makeEmail("register");

test.describe("register", () => {
  test("a new visitor can create an account through the form and reach the dashboard", async ({ page }) => {
    await page.goto("/register");

    // The sign-up form renders its three fields.
    const name = page.getByPlaceholder("Priya Raman");
    const email = page.getByPlaceholder("you@company.com");
    const password = page.getByPlaceholder("••••••••");
    await expect(name).toBeVisible();
    await expect(email).toBeVisible();
    await expect(password).toBeVisible();

    await name.fill("E2E Tester");
    await email.fill(REGISTER_EMAIL);
    // Password must be ≥12 chars per the zod resolver (mirrors RegisterInput).
    await password.fill(RUN_PASSWORD);
    await page.getByRole("button", { name: "Create account" }).click();

    // On success the app stores the session and navigates to the dashboard link
    // list — the same destination login lands on.
    await expect(page).toHaveURL(/\/links$/);
    // The authenticated shell is present (this control only renders past the
    // client-side route guard, so reaching it proves the session was stored).
    await expect(page.getByRole("button", { name: /New link|Create a link/ }).first()).toBeVisible();
  });

  test("a too-short password blocks sign-up and keeps the user on the register page", async ({ page }) => {
    await page.goto("/register");

    await page.getByPlaceholder("Priya Raman").fill("E2E Tester");
    // Use the same run-unique email — the short-password test never reaches the
    // API, so it will not conflict with the successful-register test above even
    // though both use the same address.
    await page.getByPlaceholder("you@company.com").fill(REGISTER_EMAIL);
    // Under the 12-character minimum: the zod resolver rejects it client-side.
    await page.getByPlaceholder("••••••••").fill("short");
    await page.getByRole("button", { name: "Create account" }).click();

    // The resolver surfaces its message and submission never fires, so the user
    // stays on /register and never reaches the dashboard. Assert the real
    // invariant — no navigation — plus the validation message.
    await expect(page).toHaveURL(/\/register$/);
    await expect(page.getByText("Use at least 12 characters — length beats complexity")).toBeVisible();
    await expect(page.getByRole("button", { name: /New link|Create a link/ })).toHaveCount(0);
  });
});
