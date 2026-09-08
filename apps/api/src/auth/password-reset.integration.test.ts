import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { JwtService } from "@nestjs/jwt";
import * as argon2 from "argon2";
import { and, createDatabase, eq, isNull, passwordResetTokens, refreshTokens, users, type Database } from "@snapurl/database";
import { AuthService } from "./auth.service.js";
import { TokenService } from "./token.service.js";
import type { TotpService } from "./totp.service.js";
import type { OAuthService } from "./oauth.service.js";
import type { MailService } from "../mail/mail.service.js";
import type { Env } from "../config/env.js";

/* ============================================================
   Password-reset flow against a real Postgres.

   The whole point of this feature is behaviour a mock can't verify: the
   anti-enumeration guarantee (no work, no mail for an unknown email), the
   single-use + expiry semantics of the token (guarded by a conditional
   UPDATE), and the "reset kills every session" invariant. Those are all
   properties of how Postgres evaluates the guarded writes.

   Runs only when DATABASE_URL is set — same convention as the other
   *.integration.test.ts files (the compose CI harness provides it).
   ============================================================ */

const DATABASE_URL = process.env.DATABASE_URL;
const describeDb = DATABASE_URL ? describe : describe.skip;

const ARGON = { type: argon2.argon2id, memoryCost: 19_456, timeCost: 2, parallelism: 1 } as const;

/** Records what would have been emailed, so we can assert send-or-not. */
class FakeMail {
  sent: Array<{ to: string; token: string }> = [];
  async sendPasswordReset(opts: { to: string; token: string }) {
    this.sent.push(opts);
  }
}

const env = {
  JWT_ACCESS_SECRET: "test-access-secret",
  JWT_ACCESS_TTL: "15m",
  JWT_REFRESH_TTL_DAYS: 30,
} as unknown as Env;

describeDb("AuthService password reset", () => {
  let handle: ReturnType<typeof createDatabase>;
  let db: Database;
  let tokens: TokenService;
  let mail: FakeMail;
  let auth: AuthService;

  const stamp = Date.now();
  const email = `reset-${stamp}@example.com`;
  let userId: string;

  async function seedUser(): Promise<string> {
    const passwordHash = await argon2.hash("original-password-123", ARGON);
    const [u] = await db
      .insert(users)
      .values({ name: "Reset Tester", email, passwordHash })
      .returning({ id: users.id });
    return u!.id;
  }

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
    userId = await seedUser();
  });

  afterAll(async () => {
    await db.delete(users).where(eq(users.id, userId));
    await handle.close?.();
  });

  it("request for an unknown email sends nothing (no enumeration)", async () => {
    const before = mail.sent.length;
    await auth.requestPasswordReset(`nobody-${stamp}@example.com`);
    expect(mail.sent.length).toBe(before);
  });

  it("request for a known email stores a hashed token and sends mail", async () => {
    await auth.requestPasswordReset(email);
    const last = mail.sent.at(-1)!;
    expect(last.to).toBe(email);
    expect(last.token).toBeTruthy();

    const rows = await db
      .select()
      .from(passwordResetTokens)
      .where(and(eq(passwordResetTokens.userId, userId), isNull(passwordResetTokens.usedAt)));
    expect(rows).toHaveLength(1);
    // Only the hash is stored, never the plaintext token.
    expect(rows[0]!.tokenHash).not.toBe(last.token);
  });

  it("a new request invalidates the prior unused token", async () => {
    await auth.requestPasswordReset(email);
    await auth.requestPasswordReset(email);
    const unused = await db
      .select()
      .from(passwordResetTokens)
      .where(and(eq(passwordResetTokens.userId, userId), isNull(passwordResetTokens.usedAt)));
    expect(unused).toHaveLength(1);
  });

  it("confirm with a valid token changes the hash and revokes sessions", async () => {
    // Give the user a live session first.
    await tokens.issueRefreshToken(userId);
    await auth.requestPasswordReset(email);
    const token = mail.sent.at(-1)!.token;

    await auth.confirmPasswordReset(token, "a-brand-new-password-456");

    const [u] = await db.select().from(users).where(eq(users.id, userId));
    expect(await argon2.verify(u!.passwordHash!, "a-brand-new-password-456")).toBe(true);

    const live = await db
      .select()
      .from(refreshTokens)
      .where(and(eq(refreshTokens.userId, userId), isNull(refreshTokens.revokedAt)));
    expect(live).toHaveLength(0);
  });

  it("a reset token is single-use", async () => {
    await auth.requestPasswordReset(email);
    const token = mail.sent.at(-1)!.token;
    await auth.confirmPasswordReset(token, "second-new-password-789");
    await expect(auth.confirmPasswordReset(token, "third-password-000")).rejects.toThrow();
  });

  it("confirm with an unknown token is rejected", async () => {
    await expect(auth.confirmPasswordReset("not-a-real-token", "whatever-123456")).rejects.toThrow();
  });
});
