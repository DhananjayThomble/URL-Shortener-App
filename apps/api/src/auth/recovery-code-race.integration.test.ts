import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { JwtService } from "@nestjs/jwt";
import { createDatabase, domains, eq, inArray, memberships, recoveryCodes, users, workspaces, type Database } from "@snapurl/database";
import { AuthService } from "./auth.service.js";
import { TokenService } from "./token.service.js";
import type { TotpService } from "./totp.service.js";
import type { OAuthService } from "./oauth.service.js";
import type { MailService } from "../mail/mail.service.js";
import type { Env } from "../config/env.js";

/* ============================================================
   A recovery code is single-use (#776) even under concurrent verifies.

   Two 2FA verifies racing on the same recovery code must not both get a
   session: exactly one claims the code, the other is refused. Driven against
   a real Postgres (DATABASE_URL), like the other *.integration.test.ts files.
   The TOTP check is stubbed to refuse and the hash check to accept after a
   short delay, so both requests are guaranteed to pass the hash check before
   either writes — the window the real (slow) argon2 check opens.
   ============================================================ */

const DATABASE_URL = process.env.DATABASE_URL;
const describeDb = DATABASE_URL ? describe : describe.skip;

class FakeMail {
  async sendEmailVerification() {}
  async sendPasswordReset() {}
}

const stamp = Date.now();
const testDomain = `rc-race-${stamp}.test`;

const env = {
  JWT_ACCESS_SECRET: "test-access-secret",
  JWT_ACCESS_TTL: "15m",
  JWT_REFRESH_TTL_DAYS: 30,
  DEFAULT_DOMAIN: testDomain,
} as unknown as Env;

const slowAcceptingTotp = {
  verify: () => false,
  verifyRecoveryCode: async () => {
    await new Promise((r) => setTimeout(r, 50));
    return true;
  },
} as unknown as TotpService;

describeDb("AuthService.verifyTotp recovery code under concurrency", () => {
  let handle: ReturnType<typeof createDatabase>;
  let db: Database;
  let auth: AuthService;
  let tokens: TokenService;
  let userId: string;

  beforeAll(async () => {
    handle = createDatabase({ url: DATABASE_URL!, max: 10 });
    db = handle.db;
    tokens = new TokenService(db, env, new JwtService());
    auth = new AuthService(
      db,
      env,
      tokens,
      slowAcceptingTotp,
      {} as unknown as OAuthService,
      new FakeMail() as unknown as MailService,
    );
    const session = await auth.register({
      name: `RC Race ${stamp}`,
      email: `rc-race-${stamp}@example.com`,
      password: "a-strong-password-123",
    });
    userId = session.user.id;
    await db
      .update(users)
      .set({ totpSecret: "JBSWY3DPEHPK3PXP", totpEnabledAt: new Date() })
      .where(eq(users.id, userId));
    await db.insert(recoveryCodes).values({ userId, codeHash: "stub-hash" });
  });

  afterAll(async () => {
    const ms = await db.select({ workspaceId: memberships.workspaceId }).from(memberships).where(eq(memberships.userId, userId));
    await db.delete(users).where(eq(users.id, userId));
    if (ms.length > 0) await db.delete(workspaces).where(inArray(workspaces.id, ms.map((m) => m.workspaceId)));
    await db.delete(domains).where(eq(domains.domain, testDomain));
    await handle.close?.();
  });

  it("lets exactly one of two concurrent verifies spend the same recovery code", async () => {
    const [a, b] = await Promise.all([tokens.signChallengeToken(userId), tokens.signChallengeToken(userId)]);
    const results = await Promise.allSettled([
      auth.verifyTotp(a, "ABCDE-FGHJK"),
      auth.verifyTotp(b, "ABCDE-FGHJK"),
    ]);
    expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
    expect(results.filter((r) => r.status === "rejected")).toHaveLength(1);

    const rows = await db.select().from(recoveryCodes).where(eq(recoveryCodes.userId, userId));
    expect(rows).toHaveLength(1);
    expect(rows[0]!.usedAt).not.toBeNull();
  });
});
