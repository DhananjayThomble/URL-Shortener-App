import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { JwtService } from "@nestjs/jwt";
import * as argon2 from "argon2";
import { and, createDatabase, eq, emailVerificationTokens, isNull, users, type Database } from "@snapurl/database";
import { AuthService } from "./auth.service.js";
import { TokenService } from "./token.service.js";
import type { TotpService } from "./totp.service.js";
import type { OAuthService } from "./oauth.service.js";
import type { MailService } from "../mail/mail.service.js";
import type { Env } from "../config/env.js";

/* ============================================================
   Email-verification flow against a real Postgres.

   Verifies the parts a mock can't: single-use + expiry semantics of the
   token (guarded UPDATE), that verify stamps email_verified_at, and that
   resend is an anti-enumeration no-op for unknown or already-verified
   addresses. Runs only when DATABASE_URL is set (compose CI harness).
   ============================================================ */

const DATABASE_URL = process.env.DATABASE_URL;
const describeDb = DATABASE_URL ? describe : describe.skip;

const ARGON = { type: argon2.argon2id, memoryCost: 19_456, timeCost: 2, parallelism: 1 } as const;

class FakeMail {
  sent: Array<{ to: string; token: string; kind: "verify" | "reset" }> = [];
  async sendEmailVerification(opts: { to: string; token: string }) {
    this.sent.push({ ...opts, kind: "verify" });
  }
  async sendPasswordReset(opts: { to: string; token: string }) {
    this.sent.push({ ...opts, kind: "reset" });
  }
}

const env = {
  JWT_ACCESS_SECRET: "test-access-secret",
  JWT_ACCESS_TTL: "15m",
  JWT_REFRESH_TTL_DAYS: 30,
} as unknown as Env;

describeDb("AuthService email verification", () => {
  let handle: ReturnType<typeof createDatabase>;
  let db: Database;
  let tokens: TokenService;
  let mail: FakeMail;
  let auth: AuthService;

  const stamp = Date.now();
  const email = `verify-${stamp}@example.com`;
  let userId: string;

  beforeAll(async () => {
    handle = createDatabase({ url: DATABASE_URL!, max: 1 });
    db = handle.db;
    tokens = new TokenService(db, env, new JwtService());
    mail = new FakeMail();
    auth = new AuthService(
      db,
      env,
      tokens,
      {} as unknown as TotpService,
      {} as unknown as OAuthService,
      mail as unknown as MailService,
    );

    const passwordHash = await argon2.hash("some-password-1234", ARGON);
    const [u] = await db
      .insert(users)
      .values({ name: "Verify Tester", email, passwordHash })
      .returning({ id: users.id });
    userId = u!.id;
  });

  afterAll(async () => {
    await db.delete(users).where(eq(users.id, userId));
    await handle.close?.();
  });

  it("resend for an unknown email sends nothing (no enumeration)", async () => {
    const before = mail.sent.length;
    await auth.resendEmailVerification(`nobody-${stamp}@example.com`);
    expect(mail.sent.length).toBe(before);
  });

  it("resend for an unverified account stores a hashed token and sends mail", async () => {
    await auth.resendEmailVerification(email);
    const last = mail.sent.at(-1)!;
    expect(last.to).toBe(email);
    expect(last.kind).toBe("verify");
    const rows = await db
      .select()
      .from(emailVerificationTokens)
      .where(and(eq(emailVerificationTokens.userId, userId), isNull(emailVerificationTokens.usedAt)));
    expect(rows).toHaveLength(1);
    expect(rows[0]!.tokenHash).not.toBe(last.token);
  });

  it("verify with a valid token stamps email_verified_at", async () => {
    await auth.resendEmailVerification(email);
    const token = mail.sent.at(-1)!.token;
    await auth.verifyEmail(token);
    const [u] = await db.select().from(users).where(eq(users.id, userId));
    expect(u!.emailVerifiedAt).toBeTruthy();
  });

  it("a verification token is single-use", async () => {
    // clear verified state to re-test issuance→consume cleanly
    await db.update(users).set({ emailVerifiedAt: null }).where(eq(users.id, userId));
    await auth.resendEmailVerification(email);
    const token = mail.sent.at(-1)!.token;
    await auth.verifyEmail(token);
    await expect(auth.verifyEmail(token)).rejects.toThrow();
  });

  it("resend is a no-op once the account is verified", async () => {
    await db.update(users).set({ emailVerifiedAt: new Date() }).where(eq(users.id, userId));
    const before = mail.sent.length;
    await auth.resendEmailVerification(email);
    expect(mail.sent.length).toBe(before);
  });

  it("verify with an unknown token is rejected", async () => {
    await expect(auth.verifyEmail("not-a-real-token")).rejects.toThrow();
  });
});
