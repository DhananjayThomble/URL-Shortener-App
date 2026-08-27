import { z } from "zod";
import { MemberRole } from "./workspace.js";

export const AuthUser = z.object({
  id: z.string(),
  name: z.string(),
  email: z.string(),
  initials: z.string(),
  role: MemberRole,
});
export type AuthUser = z.infer<typeof AuthUser>;

export const AuthSession = z.object({
  accessToken: z.string(),
  refreshToken: z.string(),
  user: AuthUser,
});
export type AuthSession = z.infer<typeof AuthSession>;

export const LoginInput = z.object({
  email: z.string().email(),
  password: z.string().min(1),
});
export type LoginInput = z.infer<typeof LoginInput>;

export const RegisterInput = z.object({
  name: z.string().min(1).max(80),
  email: z.string().email(),
  password: z
    .string()
    .min(12, "Use at least 12 characters — length beats complexity")
    .max(200, "That's longer than we can hash"),
});
export type RegisterInput = z.infer<typeof RegisterInput>;

export const RefreshInput = z.object({ refreshToken: z.string().min(1) });
export type RefreshInput = z.infer<typeof RefreshInput>;

export const TokenPair = z.object({
  accessToken: z.string(),
  refreshToken: z.string(),
});
export type TokenPair = z.infer<typeof TokenPair>;

/* G6 — Member.twoFactor was rendered by the team page with no flow behind it.

   Login now has two possible shapes. Without 2FA it returns a session, exactly
   as before, so the existing frontend keeps working. With 2FA it returns a
   challenge instead, and the client posts the code to /auth/2fa/verify. */
export const TotpChallenge = z.object({
  challenge: z.literal("totp"),
  challengeToken: z.string(),
});
export type TotpChallenge = z.infer<typeof TotpChallenge>;

export const LoginResult = z.union([AuthSession, TotpChallenge]);
export type LoginResult = z.infer<typeof LoginResult>;

export const TotpSetup = z.object({
  /** Feed this to a QR renderer. The frontend already ships `qrcode`. */
  otpauthUri: z.string(),
  secret: z.string(),
});
export type TotpSetup = z.infer<typeof TotpSetup>;

export const TotpEnableInput = z.object({ code: z.string().regex(/^\d{6}$/, "Six digits") });
export type TotpEnableInput = z.infer<typeof TotpEnableInput>;

/** Ten single-use codes, shown once. Without these a lost phone is a lost account. */
export const TotpRecoveryCodes = z.object({ recoveryCodes: z.array(z.string()) });
export type TotpRecoveryCodes = z.infer<typeof TotpRecoveryCodes>;

export const TotpVerifyInput = z.object({
  challengeToken: z.string(),
  /** A six-digit TOTP code, or one of the recovery codes. */
  code: z.string().min(6).max(40),
});
export type TotpVerifyInput = z.infer<typeof TotpVerifyInput>;

export const TotpDisableInput = z.object({ password: z.string().min(1) });
export type TotpDisableInput = z.infer<typeof TotpDisableInput>;

/* G2 — logout was client-side only, so the refresh token stayed valid for its
   full 30-day life after the user signed out. This revokes the whole family. */
export const LogoutInput = z.object({
  refreshToken: z.string().min(1),
  /** Revoke every session for this user, not just this device. */
  allDevices: z.boolean().default(false),
});
export type LogoutInput = z.infer<typeof LogoutInput>;
