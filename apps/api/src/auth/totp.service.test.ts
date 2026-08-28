import { authenticator } from "otplib";
import { describe, expect, it } from "vitest";
import { TotpService } from "./totp.service.js";

/* Two-factor is the whole of G6, and none of it was asserted. The parts that
   matter without a database are the ones a user hits when something has gone
   wrong: a phone whose clock has drifted, and a recovery code read off paper. */

const svc = new TotpService();

describe("TotpService — TOTP codes", () => {
  it("accepts a code generated for the current step", () => {
    const secret = svc.generateSecret();
    expect(svc.verify(authenticator.generate(secret), secret)).toBe(true);
  });

  it("accepts one step of drift either side", () => {
    // A phone clock a few seconds out is routine; rejecting it is a support
    // ticket, which is why the service sets window: 1.
    const secret = svc.generateSecret();
    const step = 30_000;

    const previous = authenticator.clone({ epoch: Date.now() - step });
    const next = authenticator.clone({ epoch: Date.now() + step });

    expect(svc.verify(previous.generate(secret), secret)).toBe(true);
    expect(svc.verify(next.generate(secret), secret)).toBe(true);
  });

  it("rejects a code from outside the drift window", () => {
    // Four steps back is two minutes — a captured code, not a slow clock.
    const secret = svc.generateSecret();
    const stale = authenticator.clone({ epoch: Date.now() - 4 * 30_000 });
    expect(svc.verify(stale.generate(secret), secret)).toBe(false);
  });

  it("ignores whitespace, so a code pasted from an authenticator app works", () => {
    const secret = svc.generateSecret();
    const code = authenticator.generate(secret);
    expect(svc.verify(`${code.slice(0, 3)} ${code.slice(3)}`, secret)).toBe(true);
  });

  it("rejects a code for a different secret", () => {
    const code = authenticator.generate(svc.generateSecret());
    expect(svc.verify(code, svc.generateSecret())).toBe(false);
  });

  it("returns false rather than throwing on malformed input", () => {
    // The code arrives from a form. A throw here would be a 500 on a typo.
    const secret = svc.generateSecret();
    expect(svc.verify("", secret)).toBe(false);
    expect(svc.verify("not-a-code", secret)).toBe(false);
    expect(svc.verify("000000", "not-a-valid-secret")).toBe(false);
  });

  it("generates distinct secrets", () => {
    const secrets = new Set(Array.from({ length: 20 }, () => svc.generateSecret()));
    expect(secrets.size).toBe(20);
  });

  it("builds an otpauth URI a QR renderer can consume", () => {
    const uri = svc.otpauthUri("sam@example.com", svc.generateSecret());
    expect(uri).toMatch(/^otpauth:\/\/totp\//);
    expect(uri).toContain("issuer=SnapURL");
  });
});

describe("TotpService — recovery codes", () => {
  it("issues ten distinct codes", () => {
    const codes = svc.generateRecoveryCodes();
    expect(codes).toHaveLength(10);
    expect(new Set(codes).size).toBe(10);
  });

  it("formats them in two groups of five for reading off paper", () => {
    for (const code of svc.generateRecoveryCodes()) {
      expect(code).toMatch(/^[0-9A-Z]{5}-[0-9A-Z]{5}$/);
    }
  });

  it("avoids look-alike characters", () => {
    // 0/O and 1/I/L are the transcription errors that turn a lost phone into
    // a lost account, so the alphabet excludes them entirely.
    const joined = svc.generateRecoveryCodes(200).join("");
    expect(joined).not.toMatch(/[01ILO]/);
  });

  it("verifies a code against its own hash", async () => {
    const [code] = svc.generateRecoveryCodes(1);
    const hash = await svc.hashRecoveryCode(code!);
    expect(hash).not.toContain(code!);
    await expect(svc.verifyRecoveryCode(hash, code!)).resolves.toBe(true);
  });

  it("normalises case and whitespace on the way in and out", async () => {
    // Someone reading a code off paper types it lowercase, or with the dash
    // spaced out. All of these are the same code.
    const [code] = svc.generateRecoveryCodes(1);
    const hash = await svc.hashRecoveryCode(code!.toLowerCase());

    await expect(svc.verifyRecoveryCode(hash, code!)).resolves.toBe(true);
    await expect(svc.verifyRecoveryCode(hash, code!.toLowerCase())).resolves.toBe(true);
    await expect(svc.verifyRecoveryCode(hash, ` ${code!} `)).resolves.toBe(true);
    await expect(svc.verifyRecoveryCode(hash, code!.replace("-", " - "))).resolves.toBe(true);
  });

  it("rejects a different code", async () => {
    const [a, b] = svc.generateRecoveryCodes(2);
    const hash = await svc.hashRecoveryCode(a!);
    await expect(svc.verifyRecoveryCode(hash, b!)).resolves.toBe(false);
  });

  it("returns false rather than throwing on a malformed hash", async () => {
    // argon2.verify throws on a string that is not a PHC hash; a stored value
    // that somehow got corrupted must not 500 the login.
    await expect(svc.verifyRecoveryCode("not-a-hash", "ABCDE-FGHJK")).resolves.toBe(false);
  });
});
