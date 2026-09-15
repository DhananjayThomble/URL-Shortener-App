import { refs, route } from "../registry.js";

const tag = "Auth";

route({
  method: "post",
  path: "/auth/register",
  tag,
  summary: "Register a new account and workspace",
  public: true,
  body: refs.RegisterInput,
  responses: { 201: { description: "A new session", schema: refs.AuthSession } },
});

route({
  method: "post",
  path: "/auth/login",
  tag,
  summary: "Sign in with email and password (5/min per IP)",
  public: true,
  body: refs.LoginInput,
  responses: {
    200: {
      description: "A session, or a TOTP challenge if the account has 2FA enabled",
      schema: refs.LoginResult,
    },
  },
});

route({
  method: "post",
  path: "/auth/oauth",
  tag,
  summary: "Sign in with a Google or Apple ID token, bound to a nonce (#263)",
  public: true,
  body: refs.OAuthSignInInput,
  responses: {
    200: {
      description: "A session, or a TOTP challenge if the account has 2FA enabled",
      schema: refs.LoginResult,
    },
  },
});

route({
  method: "post",
  path: "/auth/refresh",
  tag,
  summary: "Exchange a refresh token for a new token pair",
  public: true,
  body: refs.RefreshInput,
  responses: { 200: { description: "A new access/refresh token pair", schema: refs.TokenPair } },
});

route({
  method: "post",
  path: "/auth/logout",
  tag,
  summary: "Revoke a refresh token's whole family (G2)",
  public: true,
  body: refs.LogoutInput,
  responses: { 204: { description: "Revoked" } },
});

/* P0 — account recovery. Both public: someone locked out has no session.
   request always answers 202 with no body, the same for known and unknown
   emails, so it isn't an enumeration oracle. */
route({
  method: "post",
  path: "/auth/password-reset/request",
  tag,
  summary: "Request a password reset email (5/min per IP, same response for any email)",
  public: true,
  body: refs.PasswordResetRequestInput,
  responses: { 202: { description: "Accepted" } },
});

route({
  method: "post",
  path: "/auth/password-reset/confirm",
  tag,
  summary: "Consume a password reset token and set a new password (5/min per IP)",
  public: true,
  body: refs.PasswordResetConfirmInput,
  responses: { 200: { description: "Password reset" } },
});

/* P0 — email verification. verify is public since the link is clicked from an
   email, often before signing in. resend is public + throttled and, like
   password-reset request, gives the same response for any email. */
route({
  method: "post",
  path: "/auth/email/verify",
  tag,
  summary: "Consume an email verification token",
  public: true,
  body: refs.EmailVerifyInput,
  responses: { 200: { description: "Email verified" } },
});

route({
  method: "post",
  path: "/auth/email/resend",
  tag,
  summary: "Resend the email verification link (5/min per IP, same response for any email)",
  public: true,
  body: refs.EmailVerifyResendInput,
  responses: { 202: { description: "Accepted" } },
});

route({
  method: "get",
  path: "/auth/me",
  tag,
  summary: "The signed-in user",
  responses: { 200: { description: "The current user", schema: refs.AuthUser } },
});

route({
  method: "post",
  path: "/auth/2fa/setup",
  tag,
  summary: "Start TOTP enrolment",
  responses: { 201: { description: "otpauth:// URI to render as a QR code, plus the raw secret", schema: refs.TotpSetup } },
});

route({
  method: "post",
  path: "/auth/2fa/enable",
  tag,
  summary: "Confirm TOTP enrolment",
  body: refs.TotpEnableInput,
  responses: { 200: { description: "Ten single-use recovery codes, shown once", schema: refs.TotpRecoveryCodes } },
});

route({
  method: "post",
  path: "/auth/2fa/verify",
  tag,
  summary: "Complete a login that returned a TOTP challenge (5/min per IP)",
  public: true,
  body: refs.TotpVerifyInput,
  responses: { 200: { description: "A session", schema: refs.AuthSession } },
});

route({
  method: "post",
  path: "/auth/2fa/disable",
  tag,
  summary: "Turn off TOTP",
  body: refs.TotpDisableInput,
  responses: { 204: { description: "Disabled" } },
});
