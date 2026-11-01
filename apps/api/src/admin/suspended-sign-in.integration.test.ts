import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { ForbiddenException, UnauthorizedException } from "@nestjs/common";
import { JwtService } from "@nestjs/jwt";
import {
  and,
  createDatabase,
  eq,
  inArray,
  isNull,
  refreshTokens,
  users,
  workspaces,
  type Database,
} from "@snapurl/database";
import { AuthService } from "../auth/auth.service.js";
import { TokenService } from "../auth/token.service.js";
import type { TotpService } from "../auth/totp.service.js";
import type { OAuthService } from "../auth/oauth.service.js";
import type { MailService } from "../mail/mail.service.js";
import type { WorkspaceRemovalService } from "../workspaces/workspace-removal.service.js";
import type { Env } from "../config/env.js";
import { AdminManagementService, type AdminActor } from "./admin-management.service.js";

/* ============================================================
   #969 — a suspended account cannot sign in, and its live sessions stop.

   Proves the two halves of the acceptance line:
     (1) suspendUser stamps suspended_at AND revokes every refresh-token family
         (so an existing session cannot renew — its short-lived access token is
         the only thing left, and it dies on its own);
     (2) the sign-in paths (password login, and refresh) REFUSE a suspended
         account even if a credential or a surviving token is presented.

   Red-on-broken: without the assertNotSuspended checks in AuthService, a
   suspended user's login() and refresh() would succeed, and these expectations
   would fail. Without the revoke-all in suspendUser, the pre-suspension refresh
   token would still rotate.

   DB-gated like the other integration suites: skips with no DATABASE_URL.
   ============================================================ */

const DATABASE_URL = process.env.DATABASE_URL;
const describeDb = DATABASE_URL ? describe : describe.skip;

class FakeMail {
  async sendEmailVerification() {}
  async sendInvite() {}
  async sendPasswordReset() {}
}

const env = {
  JWT_ACCESS_SECRET: "test-access-secret-for-suspended-sign-in",
  JWT_ACCESS_TTL: "15m",
  JWT_REFRESH_TTL_DAYS: 30,
  DEFAULT_DOMAIN: "localhost:3002",
} as unknown as Env;

const PASSWORD = "suspended-sign-in-password-123";

function claims(accessToken: string): { sub: string; wid: string; role: string } {
  return JSON.parse(Buffer.from(accessToken.split(".")[1]!, "base64url").toString());
}

describeDb("#969 — suspension blocks sign-in and stops sessions", () => {
  let handle: ReturnType<typeof createDatabase>;
  let db: Database;
  let tokens: TokenService;
  let auth: AuthService;
  let admin: AdminManagementService;

  const stamp = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const userIds: string[] = [];
  const workspaceIds: string[] = [];

  // The admin actor must be a real user row: admin_audit_log.actor_id FKs
  // users.id. Seeded in beforeAll, then used as the AdminActor for every call.
  let adminActor: AdminActor;

  async function newUser(tag: string) {
    const email = `susp-${tag}-${stamp}@example.com`;
    const session = await auth.register({ name: `S ${tag}`, email, password: PASSWORD });
    userIds.push(session.user.id);
    workspaceIds.push(claims(session.accessToken).wid);
    await db.update(users).set({ emailVerifiedAt: new Date() }).where(eq(users.id, session.user.id));
    return { ...session, email };
  }

  beforeAll(async () => {
    handle = createDatabase({ url: DATABASE_URL!, max: 4 });
    db = handle.db;
    tokens = new TokenService(db, env, new JwtService());
    const mail = new FakeMail() as unknown as MailService;
    auth = new AuthService(db, env, tokens, {} as TotpService, {} as OAuthService, mail);
    admin = new AdminManagementService(
      db,
      tokens,
      mail,
      // Not exercised by these cases; suspend/signin never delete a workspace.
      {} as WorkspaceRemovalService,
    );

    const [adminRow] = await db
      .insert(users)
      .values({ name: "Platform Admin", email: `admin-${stamp}@snapurl.test`, emailVerifiedAt: new Date() })
      .returning({ id: users.id, email: users.email });
    userIds.push(adminRow!.id);
    adminActor = { admin: { id: adminRow!.id, name: "Platform Admin", email: adminRow!.email }, ip: "203.0.113.9" };
  });

  afterAll(async () => {
    if (workspaceIds.length) await db.delete(workspaces).where(inArray(workspaces.id, workspaceIds));
    if (userIds.length) await db.delete(users).where(inArray(users.id, userIds));
    await handle.close?.();
  });

  it("a suspended user cannot sign in with the right password", async () => {
    const u = await newUser("login");
    // Baseline: the credentials work before suspension.
    await expect(auth.login({ email: u.email, password: PASSWORD })).resolves.toHaveProperty("accessToken");

    await admin.suspendUser(u.user.id, adminActor);

    await expect(auth.login({ email: u.email, password: PASSWORD })).rejects.toBeInstanceOf(ForbiddenException);
  });

  it("suspension revokes every refresh-token family, so a pre-suspension session cannot refresh", async () => {
    const u = await newUser("refresh");
    // The session issued at registration refreshes fine before suspension.
    const rotated = await auth.refresh(u.refreshToken);
    expect(rotated.accessToken).toBeTruthy();

    await admin.suspendUser(u.user.id, adminActor);

    // Every family is revoked: the rotated token (the live one) no longer works.
    await expect(auth.refresh(rotated.refreshToken)).rejects.toBeInstanceOf(UnauthorizedException);

    // And no live (un-revoked) refresh token remains for the user.
    const live = await db
      .select({ id: refreshTokens.id })
      .from(refreshTokens)
      .where(and(eq(refreshTokens.userId, u.user.id), isNull(refreshTokens.revokedAt)));
    expect(live).toHaveLength(0);
  });

  it("unsuspend lets the user sign in again", async () => {
    const u = await newUser("unsuspend");
    await admin.suspendUser(u.user.id, adminActor);
    await expect(auth.login({ email: u.email, password: PASSWORD })).rejects.toBeInstanceOf(ForbiddenException);

    await admin.unsuspendUser(u.user.id, adminActor);
    await expect(auth.login({ email: u.email, password: PASSWORD })).resolves.toHaveProperty("accessToken");
  });

  it("a wrong password on a suspended account still gets the generic 401, not the suspended message", async () => {
    const u = await newUser("enum");
    await admin.suspendUser(u.user.id, adminActor);
    // Anti-enumeration: the suspended check runs only after credentials pass,
    // so a wrong password is indistinguishable from an unknown address.
    await expect(auth.login({ email: u.email, password: "wrong-password-entirely" })).rejects.toBeInstanceOf(
      UnauthorizedException,
    );
  });
});
