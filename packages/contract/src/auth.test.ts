import { describe, expect, it } from "vitest";
import {
  AcceptInviteInput,
  AcceptedInvite,
  AuthSession,
  AuthUser,
  EmailVerifyInput,
  EmailVerifyResendInput,
  InviteErrorCode,
  LoginInput,
  LoginResult,
  LogoutInput,
  OAuthSignInInput,
  PasswordResetConfirmInput,
  PasswordResetRequestInput,
  RefreshInput,
  RegisterInput,
  TOTP_DISABLE_NO_PASSWORD_MESSAGE,
  TOTP_DISABLE_WRONG_PASSWORD_MESSAGE,
  TokenPair,
  TotpChallenge,
  TotpDisableInput,
  TotpEnableInput,
  TotpRecoveryCodes,
  TotpSetup,
  TotpVerifyInput,
  UserWorkspace,
  isTotpDisableCredentialRejection,
} from "./auth.js";

/* Issue #637: registration accepted a whitespace-only name because validation
   ran on the untrimmed value (min(1) is satisfied by " ") and the service only
   trimmed afterwards, so an all-whitespace name was persisted as "". The fix is
   .trim() ahead of .min()/.max() in the contract — the single source of truth
   for this payload — so the untrimmed value never reaches a passing parse. */

describe("RegisterInput.name", () => {
  it("rejects a whitespace-only name", () => {
    expect(RegisterInput.safeParse({ name: "   ", email: "a@example.com", password: "a-long-enough-password" }).success).toBe(
      false,
    );
  });

  it("rejects a single tab character", () => {
    expect(RegisterInput.safeParse({ name: "\t", email: "a@example.com", password: "a-long-enough-password" }).success).toBe(
      false,
    );
  });

  it("still rejects an empty name", () => {
    expect(RegisterInput.safeParse({ name: "", email: "a@example.com", password: "a-long-enough-password" }).success).toBe(
      false,
    );
  });

  it("trims surrounding whitespace from an otherwise-valid name", () => {
    const result = RegisterInput.safeParse({
      name: "  Priya Raman  ",
      email: "a@example.com",
      password: "a-long-enough-password",
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.name).toBe("Priya Raman");
    }
  });

  it("accepts a normal name unchanged", () => {
    const result = RegisterInput.safeParse({
      name: "Priya Raman",
      email: "a@example.com",
      password: "a-long-enough-password",
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.name).toBe("Priya Raman");
    }
  });
});

/* #646: POST /auth/2fa/disable shares a 401 between "the credential is wrong" and
   "the access token expired". The client must tell them apart by matching the
   credential messages positively, never by listing the session ones. */
describe("isTotpDisableCredentialRejection", () => {
  it("matches exactly the messages disableTotp sends for a rejected credential", () => {
    expect(isTotpDisableCredentialRejection(TOTP_DISABLE_WRONG_PASSWORD_MESSAGE)).toBe(true);
    expect(isTotpDisableCredentialRejection(TOTP_DISABLE_NO_PASSWORD_MESSAGE)).toBe(true);
    expect(isTotpDisableCredentialRejection(`  ${TOTP_DISABLE_WRONG_PASSWORD_MESSAGE} `)).toBe(true);
  });

  it("treats every session 401 as not a credential rejection", () => {
    for (const m of [
      "Your session has expired. Sign in again to continue.",
      "Sign in to continue.",
      "Unauthorized",
      "",
      "Something the API says next year",
    ]) {
      expect(isTotpDisableCredentialRejection(m)).toBe(false);
    }
  });
});


/* #895: the rest of the auth contract carried no runtime tests. These pin the
   DTO shapes, the credential-floor constraints, the TOTP code format, the
   OAuth nonce bounds (#263 replay guard) and the two enums/union, so a weakened
   schema is caught. */

describe("AuthUser / AuthSession / TokenPair / UserWorkspace shapes", () => {
  const user = { id: "u1", name: "Jo", email: "jo@acme.com", initials: "J", role: "editor" as const };
  it("AuthUser requires its fields and a valid role", () => {
    expect(AuthUser.parse(user).role).toBe("editor");
    expect(AuthUser.safeParse({ ...user, role: "root" }).success).toBe(false);
    const { id: _id, ...noId } = user;
    expect(AuthUser.safeParse(noId).success).toBe(false);
  });
  it("AuthSession nests AuthUser plus both tokens", () => {
    const s = { accessToken: "a", refreshToken: "r", user };
    expect(AuthSession.parse(s).user.email).toBe("jo@acme.com");
    expect(AuthSession.safeParse({ accessToken: "a", refreshToken: "r" }).success).toBe(false); // no user
    expect(AuthSession.safeParse({ ...s, user: { ...user, role: "nope" } }).success).toBe(false);
  });
  it("TokenPair requires both tokens (kills the shape → {} mutant)", () => {
    expect(TokenPair.parse({ accessToken: "a", refreshToken: "r" }).accessToken).toBe("a");
    expect(TokenPair.safeParse({ accessToken: "a" }).success).toBe(false);
  });
  it("UserWorkspace requires a role and a current boolean", () => {
    const w = { id: "w", name: "Acme", initials: "A", role: "admin" as const, current: true };
    expect(UserWorkspace.parse(w).current).toBe(true);
    expect(UserWorkspace.safeParse({ ...w, current: "yes" }).success).toBe(false);
    expect(UserWorkspace.safeParse({ ...w, role: "nope" }).success).toBe(false);
  });
});

describe("LoginInput / RefreshInput credential floors", () => {
  it("LoginInput needs a valid email and a non-empty password (kills min(1) → max(1))", () => {
    expect(LoginInput.safeParse({ email: "jo@acme.com", password: "x" }).success).toBe(true);
    expect(LoginInput.safeParse({ email: "jo@acme.com", password: "hunter2" }).success).toBe(true); // 7 chars — max(1) would reject
    expect(LoginInput.safeParse({ email: "jo@acme.com", password: "" }).success).toBe(false);
    expect(LoginInput.safeParse({ email: "not-an-email", password: "x" }).success).toBe(false);
    expect(LoginInput.safeParse({ email: "jo@acme.com" }).success).toBe(false); // no password
  });
  it("RefreshInput needs a non-empty refreshToken and an optional uuid workspaceId", () => {
    expect(RefreshInput.safeParse({ refreshToken: "tok" }).success).toBe(true);
    expect(RefreshInput.safeParse({ refreshToken: "" }).success).toBe(false);
    expect(RefreshInput.safeParse({ refreshToken: "tok", workspaceId: "nope" }).success).toBe(false); // uuid
    expect(
      RefreshInput.safeParse({ refreshToken: "tok", workspaceId: "11111111-1111-4111-8111-111111111111" }).success,
    ).toBe(true);
  });
});

describe("AcceptInviteInput / AcceptedInvite", () => {
  it("AcceptInviteInput needs a token of 1..200 chars (kills min(1)/max(200) mutations)", () => {
    expect(AcceptInviteInput.safeParse({ token: "t" }).success).toBe(true);
    expect(AcceptInviteInput.safeParse({ token: "a".repeat(200) }).success).toBe(true);
    expect(AcceptInviteInput.safeParse({ token: "a".repeat(201) }).success).toBe(false); // max(200) → min(200) mutant rejects valid short tokens
    expect(AcceptInviteInput.safeParse({ token: "" }).success).toBe(false);
  });
  it("AcceptedInvite returns the joined workspace id and the user", () => {
    const user = { id: "u1", name: "Jo", email: "jo@acme.com", initials: "J", role: "editor" as const };
    expect(AcceptedInvite.parse({ workspaceId: "w1", user }).workspaceId).toBe("w1");
    expect(AcceptedInvite.safeParse({ workspaceId: "w1" }).success).toBe(false); // no user
  });
});

describe("InviteErrorCode enum and LoginResult union", () => {
  it("InviteErrorCode accepts exactly its six codes", () => {
    for (const c of ["invite_invalid", "invite_expired", "invite_used", "already_member", "invite_email_mismatch", "email_unverified"]) {
      expect(InviteErrorCode.safeParse(c).success).toBe(true);
    }
    expect(InviteErrorCode.safeParse("invite_unknown").success).toBe(false);
  });
  it("LoginResult accepts either a session or a TOTP challenge, not junk", () => {
    const user = { id: "u1", name: "Jo", email: "jo@acme.com", initials: "J", role: "editor" as const };
    expect(LoginResult.safeParse({ accessToken: "a", refreshToken: "r", user }).success).toBe(true);
    expect(LoginResult.safeParse({ challenge: "totp", challengeToken: "ct" }).success).toBe(true);
    expect(LoginResult.safeParse({ challenge: "sms", challengeToken: "ct" }).success).toBe(false); // literal "totp"
    expect(LoginResult.safeParse({}).success).toBe(false);
  });
});

describe("TOTP schemas", () => {
  it("TotpChallenge requires the literal 'totp' and a token", () => {
    expect(TotpChallenge.parse({ challenge: "totp", challengeToken: "ct" }).challenge).toBe("totp");
    expect(TotpChallenge.safeParse({ challenge: "email", challengeToken: "ct" }).success).toBe(false);
  });
  it("TotpSetup / TotpRecoveryCodes require their fields", () => {
    expect(TotpSetup.parse({ otpauthUri: "otpauth://x", secret: "S" }).secret).toBe("S");
    expect(TotpSetup.safeParse({ otpauthUri: "otpauth://x" }).success).toBe(false);
    expect(TotpRecoveryCodes.parse({ recoveryCodes: ["a", "b"] }).recoveryCodes.length).toBe(2);
    expect(TotpRecoveryCodes.safeParse({ recoveryCodes: [1, 2] }).success).toBe(false);
  });
  it("TotpEnableInput requires exactly six digits (kills the /^\\d{6}$/ regex mutations)", () => {
    expect(TotpEnableInput.safeParse({ code: "123456" }).success).toBe(true);
    expect(TotpEnableInput.safeParse({ code: "12345" }).success).toBe(false); // 5 digits — {6} length
    expect(TotpEnableInput.safeParse({ code: "1234567" }).success).toBe(false); // 7 digits — $ anchor
    expect(TotpEnableInput.safeParse({ code: "abcdef" }).success).toBe(false); // \d not \D
    expect(TotpEnableInput.safeParse({ code: "12345a" }).success).toBe(false); // trailing non-digit
    expect(TotpEnableInput.safeParse({ code: " 123456" }).success).toBe(false); // ^ anchor
  });
  it("TotpVerifyInput requires a code of 6..40 chars", () => {
    expect(TotpVerifyInput.safeParse({ challengeToken: "ct", code: "123456" }).success).toBe(true);
    expect(TotpVerifyInput.safeParse({ challengeToken: "ct", code: "12345" }).success).toBe(false); // min(6)
    expect(TotpVerifyInput.safeParse({ challengeToken: "ct", code: "a".repeat(40) }).success).toBe(true);
    expect(TotpVerifyInput.safeParse({ challengeToken: "ct", code: "a".repeat(41) }).success).toBe(false); // max(40) → min(40) mutant rejects 6-char codes
  });
  it("TotpDisableInput requires a non-empty password (kills min(1) → max(1) and shape → {})", () => {
    expect(TotpDisableInput.safeParse({ password: "hunter2" }).success).toBe(true);
    expect(TotpDisableInput.safeParse({ password: "" }).success).toBe(false);
    expect(TotpDisableInput.safeParse({}).success).toBe(false);
  });
});

describe("OAuthSignInInput — provider enum, idToken floor, nonce 16..256 (#263)", () => {
  const valid = { provider: "google" as const, idToken: "tok", nonce: "a".repeat(16) };
  it("accepts google/apple only", () => {
    expect(OAuthSignInInput.safeParse(valid).success).toBe(true);
    expect(OAuthSignInInput.safeParse({ ...valid, provider: "apple" }).success).toBe(true);
    expect(OAuthSignInInput.safeParse({ ...valid, provider: "facebook" }).success).toBe(false);
  });
  it("requires a non-empty idToken", () => {
    expect(OAuthSignInInput.safeParse({ ...valid, idToken: "" }).success).toBe(false);
  });
  it("requires a nonce of 16..256 chars (kills min(16)/max(256) mutations)", () => {
    expect(OAuthSignInInput.safeParse({ ...valid, nonce: "a".repeat(15) }).success).toBe(false); // below min(16)
    expect(OAuthSignInInput.safeParse({ ...valid, nonce: "a".repeat(256) }).success).toBe(true);
    expect(OAuthSignInInput.safeParse({ ...valid, nonce: "a".repeat(257) }).success).toBe(false); // above max(256) → min(256) mutant rejects 16
  });
});

describe("LogoutInput / password-reset / email-verify shapes", () => {
  it("LogoutInput needs a refreshToken and defaults allDevices to false", () => {
    const parsed = LogoutInput.parse({ refreshToken: "tok" });
    expect(parsed.allDevices).toBe(false); // kills default(false) → default(true)
    expect(LogoutInput.safeParse({ refreshToken: "" }).success).toBe(false);
  });
  it("PasswordResetRequestInput / EmailVerifyResendInput need a valid email", () => {
    expect(PasswordResetRequestInput.safeParse({ email: "jo@acme.com" }).success).toBe(true);
    expect(PasswordResetRequestInput.safeParse({ email: "nope" }).success).toBe(false);
    expect(EmailVerifyResendInput.safeParse({ email: "jo@acme.com" }).success).toBe(true);
    expect(EmailVerifyResendInput.safeParse({ email: "nope" }).success).toBe(false);
  });
  it("PasswordResetConfirmInput needs a token and a 12..200 char password (kills min(12)/max(200))", () => {
    expect(PasswordResetConfirmInput.safeParse({ token: "t", password: "a".repeat(12) }).success).toBe(true);
    expect(PasswordResetConfirmInput.safeParse({ token: "t", password: "a".repeat(11) }).success).toBe(false); // min(12) → max(12) mutant accepts 11 but rejects 200
    expect(PasswordResetConfirmInput.safeParse({ token: "t", password: "a".repeat(200) }).success).toBe(true);
    expect(PasswordResetConfirmInput.safeParse({ token: "t", password: "a".repeat(201) }).success).toBe(false); // max(200)
    expect(PasswordResetConfirmInput.safeParse({ token: "", password: "a".repeat(12) }).success).toBe(false);
  });
  it("EmailVerifyInput needs a non-empty token", () => {
    expect(EmailVerifyInput.safeParse({ token: "t" }).success).toBe(true);
    expect(EmailVerifyInput.safeParse({ token: "" }).success).toBe(false);
  });
});
