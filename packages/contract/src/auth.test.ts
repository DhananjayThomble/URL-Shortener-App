import { describe, expect, it } from "vitest";
import {
  RegisterInput,
  TOTP_DISABLE_NO_PASSWORD_MESSAGE,
  TOTP_DISABLE_WRONG_PASSWORD_MESSAGE,
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
