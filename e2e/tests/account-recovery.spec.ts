import { expect, test } from "@playwright/test";
import { makeEmail } from "../support/unique-identity";

/* E2E journey: account recovery (#363, #364, #638). Three UNauthenticated
   pages: /forgot-password, /reset-password, /verify-email. None of these seed
   a session — they drive the real forms against POST /auth/password-reset/
   {request,confirm} and POST /auth/email/{verify,resend}.

   Oracle: packages/contract/src/auth.ts —
     PasswordResetRequestInput { email }, PasswordResetConfirmInput { token, password }
     EmailVerifyInput { token }, EmailVerifyResendInput { email }
   All four give an enumeration-safe response (202/200 with no distinguishing
   body) regardless of whether the address/token is real — see auth.ts's own
   comments. That is why the "request"/"resend" tests below assert the SAME
   confirmation UI for ANY well-formed email, rather than branching on whether
   the address exists; a test that could tell the two cases apart would be
   asserting a property the API deliberately does not have.

   Fixtures mode: web/src/lib/api/fixtures.ts answers request/resend with 202
   and no body for any input, and confirm/verify reject exactly the sentinel
   token "fixture.invalid.token" (and accept any other token) — the one
   deliberate branch needed to exercise the error path without a backend.

   Real-stack mode (playwright.real.config.ts): request/resend hit the live
   API, which behaves identically for a nonexistent address — the UI assertions
   below hold unchanged. confirm/verify are exercised with a syntactically
   plausible but WRONG token, which the real API rejects the same way an
   expired/already-used token would (AuthService.confirmPasswordReset /
   verifyEmail both reject on no matching row) — this is the one case the
   browser layer can drive without reading the mail outbox out of the api
   container's filesystem, which no e2e harness in this repo currently has a
   way to do (the outbox is written to /tmp inside the container — see
   docker-compose.staging.yml's "mail is outbox, not SMTP" note; the backend
   round trip through an actual issued token is already covered at the service
   layer by auth/password-reset.integration.test.ts and
   auth/email-verification.integration.test.ts against real Postgres). */

test.describe("forgot password", () => {
  test("requesting a reset shows the same confirmation for any well-formed email", async ({ page }) => {
    await page.goto("/forgot-password");

    const email = page.getByPlaceholder("you@company.com");
    await expect(email).toBeVisible();
    await email.fill(makeEmail("forgot"));
    await page.getByRole("button", { name: "Send reset link" }).click();

    await expect(page.getByText(/check your email/i)).toBeVisible();
    await expect(page.getByRole("link", { name: "Back to sign in" })).toBeVisible();
  });

  test("an invalid email blocks submission and keeps the form visible", async ({ page }) => {
    await page.goto("/forgot-password");
    await page.getByPlaceholder("you@company.com").fill("not-an-email");
    await page.getByRole("button", { name: "Send reset link" }).click();

    await expect(page).toHaveURL(/\/forgot-password$/);
    await expect(page.getByText(/check your email/i)).toHaveCount(0);
  });

  test("/login links to /forgot-password", async ({ page }) => {
    await page.goto("/login");
    await page.getByRole("link", { name: "Forgot password?" }).click();
    await expect(page).toHaveURL(/\/forgot-password$/);
  });
});

test.describe("reset password", () => {
  test("a reset link with no token shows an error and a way to request a new one", async ({ page }) => {
    await page.goto("/reset-password");
    await expect(page.getByText(/invalid reset link/i)).toBeVisible();
    await expect(page.getByRole("link", { name: "Request a new reset link" })).toBeVisible();
  });

  test("an invalid or expired token is rejected and the form stays usable", async ({ page }) => {
    await page.goto("/reset-password?token=fixture.invalid.token");

    const password = page.getByPlaceholder("••••••••");
    await expect(password).toBeVisible();
    await password.fill("a-brand-new-password-123456");
    await page.getByRole("button", { name: "Reset password" }).click();

    await expect(page.getByText(/invalid or has expired/i)).toBeVisible();
    await expect(page).toHaveURL(/\/reset-password/);
  });

  test("a too-short password blocks submission client-side", async ({ page }) => {
    await page.goto("/reset-password?token=some-token-value");
    await page.getByPlaceholder("••••••••").fill("short");
    await page.getByRole("button", { name: "Reset password" }).click();

    await expect(page.getByText("Use at least 12 characters — length beats complexity")).toBeVisible();
  });
});

test.describe("verify email", () => {
  test("a verification link with no token shows an error", async ({ page }) => {
    await page.goto("/verify-email");
    await expect(page.getByText(/invalid verification link/i)).toBeVisible();
  });

  test("an invalid or expired token offers a resend with the same confirmation for any email", async ({ page }) => {
    await page.goto("/verify-email?token=fixture.invalid.token");

    await expect(page.getByText(/verification failed/i)).toBeVisible();
    const resendEmail = page.getByPlaceholder("you@company.com");
    await expect(resendEmail).toBeVisible();
    await resendEmail.fill(makeEmail("resend"));
    await page.getByRole("button", { name: "Resend verification email" }).click();

    await expect(page.getByText(/we've sent a new link/i)).toBeVisible();
  });
});
