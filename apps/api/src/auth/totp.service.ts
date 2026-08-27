import { Injectable } from "@nestjs/common";
import { authenticator } from "otplib";
import { randomBytes } from "node:crypto";
import * as argon2 from "argon2";

/* ============================================================
   G6 — Member.twoFactor was rendered by the team page with
   nothing behind it.

   TOTP rather than WebAuthn: the product is meant to be
   self-hostable, and WebAuthn credentials are bound to an origin.
   Someone running this on their own domain would have to
   re-enrol every key. TOTP works anywhere and needs no browser
   support story.
   ============================================================ */

@Injectable()
export class TotpService {
  constructor() {
    // One step of drift either side. Phone clocks are routinely a few seconds
    // out, and a code that "just worked a second ago" is a support ticket.
    authenticator.options = { window: 1 };
  }

  generateSecret(): string {
    return authenticator.generateSecret();
  }

  /** Feed to a QR renderer — the frontend already ships `qrcode`. */
  otpauthUri(email: string, secret: string, issuer = "SnapURL"): string {
    return authenticator.keyuri(email, issuer, secret);
  }

  verify(code: string, secret: string): boolean {
    try {
      return authenticator.verify({ token: code.replace(/\s+/g, ""), secret });
    } catch {
      return false;
    }
  }

  /**
   * Ten single-use recovery codes.
   *
   * Without these, a lost phone means a lost account — and on a side project
   * there is nobody staffing an identity-verification process to undo that.
   * Formatted in two groups so they can be read off paper without transcription
   * errors, and drawn from a base32-ish alphabet with no look-alike characters.
   */
  generateRecoveryCodes(count = 10): string[] {
    const alphabet = "23456789ABCDEFGHJKMNPQRSTUVWXYZ";
    const codes: string[] = [];
    for (let i = 0; i < count; i++) {
      const bytes = randomBytes(10);
      let code = "";
      for (let j = 0; j < 10; j++) {
        code += alphabet[bytes[j]! % alphabet.length];
        if (j === 4) code += "-";
      }
      codes.push(code);
    }
    return codes;
  }

  /** Hashed like passwords — they are passwords, just longer-lived. */
  async hashRecoveryCode(code: string): Promise<string> {
    return argon2.hash(code.toUpperCase().replace(/\s+/g, ""), { type: argon2.argon2id });
  }

  async verifyRecoveryCode(hash: string, code: string): Promise<boolean> {
    try {
      return await argon2.verify(hash, code.toUpperCase().replace(/\s+/g, ""));
    } catch {
      return false;
    }
  }
}
