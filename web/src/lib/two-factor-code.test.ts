import { describe, expect, it } from "vitest";
import {
  RECOVERY_CODE_ALPHABET,
  canSubmitCode,
  codeErrorMessage,
  codeInputProps,
  normaliseCode,
  sanitiseTyping,
} from "./two-factor-code";

/* Oracle: the 2FA step of /login (issue #776).

   POST /auth/2fa/verify takes `code` (packages/contract TotpVerifyInput: a
   string of 6–40 chars, "a six-digit TOTP code, or one of the recovery codes").
   The server first tries it as a TOTP (whitespace stripped), then against the
   user's unused recovery codes, each hashed from `code.toUpperCase()` with
   whitespace removed — and the codes it ISSUES are ten characters from the
   alphabet below, split 5-5 by a dash (TotpService.generateRecoveryCodes).

   So the dash is part of the hashed value: "abcde fghjk" or "ABCDEFGHJK" — how
   a person reads a code off paper or retypes it on a phone — would be rejected
   unless the client puts the dash back. That is this module's job. It never
   changes what the server accepts; it only maps what a person types onto the
   one spelling the server will match. */

describe("normaliseCode — totp", () => {
  it("keeps a plain six-digit code", () => {
    expect(normaliseCode("totp", "123456")).toBe("123456");
  });
  it("strips the spaces and dashes authenticator apps display", () => {
    expect(normaliseCode("totp", " 123 456 ")).toBe("123456");
    expect(normaliseCode("totp", "123-456")).toBe("123456");
    expect(normaliseCode("totp", "123\u00a0456")).toBe("123456");
  });
  it("is empty for empty / whitespace-only input", () => {
    expect(normaliseCode("totp", "")).toBe("");
    expect(normaliseCode("totp", "   ")).toBe("");
  });
});

describe("normaliseCode — recovery", () => {
  it("passes the canonical issued form through unchanged", () => {
    expect(normaliseCode("recovery", "ABCDE-FGHJK")).toBe("ABCDE-FGHJK");
  });
  it("uppercases (phones capitalise nothing by default)", () => {
    expect(normaliseCode("recovery", "abcde-fghjk")).toBe("ABCDE-FGHJK");
    expect(normaliseCode("recovery", "aBcDe-FgHjK")).toBe("ABCDE-FGHJK");
  });
  it("puts the dash back when it was typed as a space or left out", () => {
    expect(normaliseCode("recovery", "ABCDEFGHJK")).toBe("ABCDE-FGHJK");
    expect(normaliseCode("recovery", "abcde fghjk")).toBe("ABCDE-FGHJK");
    expect(normaliseCode("recovery", "  abcde   fghjk  ")).toBe("ABCDE-FGHJK");
    expect(normaliseCode("recovery", "ab cde fg hjk")).toBe("ABCDE-FGHJK");
  });
  it("accepts the dash look-alikes a phone keyboard or a PDF substitutes", () => {
    for (const dash of ["\u2010", "\u2011", "\u2012", "\u2013", "\u2014", "\u2212"]) {
      expect(normaliseCode("recovery", `ABCDE${dash}FGHJK`), JSON.stringify(dash)).toBe("ABCDE-FGHJK");
    }
  });
  it("collapses a doubled or misplaced dash to the one the server hashed", () => {
    expect(normaliseCode("recovery", "ABCDE--FGHJK")).toBe("ABCDE-FGHJK");
    expect(normaliseCode("recovery", "ABC-DEFGHJK")).toBe("ABCDE-FGHJK");
    expect(normaliseCode("recovery", "-ABCDEFGHJK-")).toBe("ABCDE-FGHJK");
  });
  it("does not invent a dash for something that is not ten characters", () => {
    // Sent as typed (cleaned) so the server rejects it with its own message,
    // rather than the client inventing a code the user never entered.
    expect(normaliseCode("recovery", "ABCDE-FGHJ")).toBe("ABCDEFGHJ");
    expect(normaliseCode("recovery", "ABCDE-FGHJKM")).toBe("ABCDEFGHJKM");
    expect(normaliseCode("recovery", "")).toBe("");
    expect(normaliseCode("recovery", " - ")).toBe("");
  });
  it("round-trips every issued shape: any 10 chars of the alphabet, any way typed", () => {
    // Exhaustive over the alphabet in each of the ten positions, with each of the
    // three ways a person can separate the halves.
    for (const ch of RECOVERY_CODE_ALPHABET) {
      for (let pos = 0; pos < 10; pos++) {
        const raw = "2".repeat(10).split("");
        raw[pos] = ch;
        const canonical = `${raw.slice(0, 5).join("")}-${raw.slice(5).join("")}`;
        for (const sep of ["-", " ", ""]) {
          const typed = `${raw.slice(0, 5).join("")}${sep}${raw.slice(5).join("")}`;
          expect(normaliseCode("recovery", typed.toLowerCase())).toBe(canonical);
        }
      }
    }
  });
});

describe("canSubmitCode", () => {
  it("totp: exactly six digits after normalising", () => {
    expect(canSubmitCode("totp", "123456")).toBe(true);
    expect(canSubmitCode("totp", "123 456")).toBe(true);
    expect(canSubmitCode("totp", "12345")).toBe(false);
    expect(canSubmitCode("totp", "1234567")).toBe(false);
    expect(canSubmitCode("totp", "")).toBe(false);
    expect(canSubmitCode("totp", "      ")).toBe(false);
    expect(canSubmitCode("totp", "12a456")).toBe(false);
    // A recovery code in the TOTP field is not a TOTP — the toggle is the way in.
    expect(canSubmitCode("totp", "ABCDE-FGHJK")).toBe(false);
  });
  it("recovery: one full XXXXX-XXXXX code, however it was spaced or cased", () => {
    expect(canSubmitCode("recovery", "ABCDE-FGHJK")).toBe(true);
    expect(canSubmitCode("recovery", "abcde fghjk")).toBe(true);
    expect(canSubmitCode("recovery", "abcdefghjk")).toBe(true);
    expect(canSubmitCode("recovery", "ABCDE-FGHJ")).toBe(false);
    expect(canSubmitCode("recovery", "ABCDE-FGHJKM")).toBe(false);
    expect(canSubmitCode("recovery", "")).toBe(false);
    expect(canSubmitCode("recovery", "     ")).toBe(false);
    expect(canSubmitCode("recovery", "ABCDE-FGHJ!")).toBe(false);
    expect(canSubmitCode("recovery", "ÄBCDE-FGHJK")).toBe(false);
    expect(canSubmitCode("recovery", "ABCDE-FGHJ😀")).toBe(false);
  });
  it("whatever it accepts fits the contract's 6–40 chars", () => {
    for (const [mode, v] of [["totp", "123 456"], ["recovery", "abcde fghjk"]] as const) {
      const n = normaliseCode(mode, v);
      expect(n.length).toBeGreaterThanOrEqual(6);
      expect(n.length).toBeLessThanOrEqual(40);
    }
  });
});

describe("sanitiseTyping", () => {
  it("totp: keeps digits only, at most six (a pasted '123 456' lands as 123456)", () => {
    expect(sanitiseTyping("totp", "123 456")).toBe("123456");
    expect(sanitiseTyping("totp", "12a3")).toBe("123");
    expect(sanitiseTyping("totp", "1234567890")).toBe("123456");
    expect(sanitiseTyping("totp", "")).toBe("");
  });
  it("recovery: uppercases but keeps the user's separators, capped at the contract max", () => {
    expect(sanitiseTyping("recovery", "abcde fghjk")).toBe("ABCDE FGHJK");
    expect(sanitiseTyping("recovery", "abcde-")).toBe("ABCDE-");
    expect(sanitiseTyping("recovery", "x".repeat(60))).toHaveLength(40);
  });
});

describe("codeInputProps", () => {
  it("totp: numeric keypad + one-time-code autofill", () => {
    const p = codeInputProps("totp");
    expect(p.inputMode).toBe("numeric");
    expect(p.autoComplete).toBe("one-time-code");
    expect(p.pattern).toBe("[0-9]*");
    expect(p.label).toBe("Authentication code");
    // A maxlength of 6 would truncate a pasted "123 456" before the space is dropped.
    expect(p.maxLength).toBeUndefined();
  });
  it("recovery: a text keyboard, no OTP autofill, no autocorrect", () => {
    const p = codeInputProps("recovery");
    expect(p.inputMode).toBe("text");
    // one-time-code would make iOS offer an SMS code — never a recovery code.
    expect(p.autoComplete).toBe("off");
    expect(p.autoCapitalize).toBe("characters");
    expect(p.autoCorrect).toBe("off");
    expect(p.spellCheck).toBe(false);
    expect(p.pattern).toBeUndefined();
    expect(p.label).toBe("Recovery code");
    expect(p.placeholder).toBe("XXXXX-XXXXX");
  });
});

describe("codeErrorMessage", () => {
  const WRONG = "That code isn't right. Try the next one from your app.";
  it("totp: the server's message stands", () => {
    expect(codeErrorMessage("totp", 401, WRONG)).toBe(WRONG);
  });
  it("recovery: a wrong code says 'recovery code' and that each works once", () => {
    const m = codeErrorMessage("recovery", 401, WRONG);
    expect(m).toMatch(/recovery code/i);
    expect(m).toMatch(/already been used/i);
    expect(m).not.toMatch(/from your app/i);
  });
  it("an expired challenge is passed through in both modes", () => {
    const expired = "That sign-in attempt timed out. Start again.";
    expect(codeErrorMessage("totp", 401, expired)).toBe(expired);
    expect(codeErrorMessage("recovery", 401, expired)).toBe(expired);
  });
  it("throttled: says so, in both modes", () => {
    const m = "Too many requests. Wait a moment and try again.";
    expect(codeErrorMessage("totp", 429, m)).toMatch(/too many/i);
    expect(codeErrorMessage("recovery", 429, m)).toMatch(/too many/i);
  });
  it("falls back when there is no message", () => {
    expect(codeErrorMessage("totp", 0, "")).toMatch(/isn't right/i);
    expect(codeErrorMessage("recovery", undefined, "")).toMatch(/recovery code/i);
  });
});
