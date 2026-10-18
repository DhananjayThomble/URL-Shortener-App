/* The 2FA step of /login (issue #776): what a person types, and what we send.

   POST /auth/2fa/verify accepts either a six-digit TOTP or one of the user's
   single-use recovery codes in the same `code` field (packages/contract
   TotpVerifyInput, 6–40 chars). The server strips whitespace from a TOTP, and
   compares a recovery code as `code.toUpperCase()` with whitespace removed
   against an argon2id hash of the code it ISSUED — ten characters of
   RECOVERY_CODE_ALPHABET, split 5-5 by a dash (apps/api TotpService).

   The dash is therefore part of the secret. A person reading a code off paper
   types "abcde fghjk" or "abcdefghjk", which the server would reject; this
   module maps those onto the issued spelling. It does not widen what the server
   accepts — a string that is not a whole code is sent as typed so the server
   rejects it with its own answer. */

export type CodeMode = "totp" | "recovery";

/** Mirrors TotpService.generateRecoveryCodes — no 0/O, 1/I/L look-alikes. */
export const RECOVERY_CODE_ALPHABET = "23456789ABCDEFGHJKMNPQRSTUVWXYZ";

/** TotpVerifyInput.code max. */
const CODE_MAX = 40;

// Whitespace (incl. NBSP) and every dash a keyboard, PDF or autocorrect substitutes.
const SEPARATORS = /[\s\-\u2010-\u2015\u2212]+/g;

// TotpService.verify strips /\s+/ and nothing else.
const TOTP_WHITESPACE = /\s+/g;

// Any ten ASCII letters/digits: a look-alike (O for 0) still reaches the server,
// which gives the real answer, instead of a Verify button that silently stays off.
const RECOVERY_SHAPE = /^[0-9A-Z]{10}$/;

/** The exact string to send as `code`. */
export function normaliseCode(mode: CodeMode, raw: string): string {
  // TOTP: exactly what TotpService.verify does (whitespace only), so the client
  // never turns a string the server would refuse into one it accepts.
  if (mode === "totp") return raw.replace(TOTP_WHITESPACE, "");
  const bare = raw.replace(SEPARATORS, "");
  const upper = bare.toUpperCase();
  return upper.length === 10 ? `${upper.slice(0, 5)}-${upper.slice(5)}` : upper;
}

/** Whether Verify is enabled. */
export function canSubmitCode(mode: CodeMode, raw: string): boolean {
  if (mode === "totp") return /^\d{6}$/.test(raw.replace(TOTP_WHITESPACE, ""));
  return RECOVERY_SHAPE.test(raw.replace(SEPARATORS, "").toUpperCase());
}

/** Applied on every keystroke/paste, so the field shows what will be sent. */
export function sanitiseTyping(mode: CodeMode, raw: string): string {
  // TOTP: drop whitespace only (as the server does) and keep every other
  // character visible, so a stray letter or dash disables Verify instead of
  // being silently removed. No truncation: a 7-digit paste is not a code.
  if (mode === "totp") return raw.replace(TOTP_WHITESPACE, "").slice(0, CODE_MAX);
  return raw.toUpperCase().slice(0, CODE_MAX);
}

export type CodeInputProps = {
  label: string;
  placeholder: string;
  inputMode: "numeric" | "text";
  autoComplete: string;
  autoCapitalize?: string;
  autoCorrect?: string;
  spellCheck?: boolean;
  pattern?: string;
  maxLength?: number;
};

/** Keyboard and autofill hints for the code field. */
export function codeInputProps(mode: CodeMode): CodeInputProps {
  if (mode === "totp") {
    return {
      label: "Authentication code",
      placeholder: "123456",
      inputMode: "numeric",
      autoComplete: "one-time-code",
      pattern: "[0-9]*",
      // No maxLength: the browser would truncate a pasted "123 456" to "123 4"
      // before sanitiseTyping could drop the space. sanitiseTyping caps at six.
    };
  }
  return {
    label: "Recovery code",
    placeholder: "XXXXX-XXXXX",
    inputMode: "text",
    // one-time-code would have iOS offer an SMS code, which is never a recovery code.
    autoComplete: "off",
    autoCapitalize: "characters",
    autoCorrect: "off",
    spellCheck: false,
    maxLength: CODE_MAX,
  };
}

const RECOVERY_REJECTED =
  "That recovery code isn't right, or it has already been used. Each code works once — try another one.";

/** The message to show under the field when POST /auth/2fa/verify fails. */
export function codeErrorMessage(mode: CodeMode, status: number | undefined, message: string): string {
  if (status === 429) return message || "Too many attempts. Wait a minute and try again.";
  // The challenge token expired (TokenService.verifyChallengeToken) — same in both modes.
  if (/timed out/i.test(message)) return message;
  if (mode === "recovery") return status === 401 || !message ? RECOVERY_REJECTED : message;
  return message || "That code isn't right.";
}
