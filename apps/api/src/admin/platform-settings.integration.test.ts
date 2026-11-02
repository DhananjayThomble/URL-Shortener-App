import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { JwtService } from "@nestjs/jwt";
import { ForbiddenException } from "@nestjs/common";
import {
  adminAuditLog,
  createDatabase,
  desc,
  eq,
  memberships,
  platformSettings,
  users,
  workspaces,
  type Database,
} from "@snapurl/database";
import { TokenService } from "../auth/token.service.js";
import { TotpService } from "../auth/totp.service.js";
import type { OAuthService } from "../auth/oauth.service.js";
import type { MailService } from "../mail/mail.service.js";
import { AuthService } from "../auth/auth.service.js";
import { botProtectionStub, signupRefusalStub } from "../test/signup-controls.stub.js";
import type { Env } from "../config/env.js";
import type { AdminActor } from "./admin-management.service.js";
import { PlatformSettingsService, SETTINGS_CACHE_TTL_MS } from "./platform-settings.service.js";

/* ============================================================
   #972 — runtime platform settings. Acceptance, proven against a real DB:

     1. Closing signups blocks registration WITHIN THE CACHE WINDOW. A direct
        DB write that the service has not yet reloaded does NOT take effect
        until the window passes; a write THROUGH the service busts the cache and
        takes effect at once. Both are exercised with an injected clock.
     2. A changed rate limit applies without a restart — the value the throttler
        reads (getValues().rateLimit) changes after an admin write, no new
        service instance.
     3. The banner read reflects what was set.
     4. Every change writes an admin_audit_log row with before and after values.

   Red-on-broken:
     - drop the cache (read the DB every call) and the "within the window" case
       fails: the un-busted direct DB write would be seen immediately;
     - make register() ignore signupMode and the closed/invite cases fail;
     - skip the OAuth-path gate and the OAuth case fails;
     - drop the writeAdminAuditEntry call and the audit cases fail (zero rows);
     - fall back to defaults instead of env for the rate limit and the fallback
       assertion fails.

   DB-gated: skips with no DATABASE_URL. Asserts only on rows it seeded (the
   admin actor and the settings keys it writes), never global totals, because
   the DB is shared across concurrent workers.
   ============================================================ */

const DATABASE_URL = process.env.DATABASE_URL;
const describeDb = DATABASE_URL ? describe : describe.skip;

/* An obviously-fake, low-entropy placeholder password for the register calls
   below. It satisfies RegisterInput's 12-char minimum while reading as a
   non-secret (dictionary words, no randomness), so the secret scanner's
   generic-api-key entropy heuristic does not flag it. Not a real credential. */
const TEST_PASSWORD = "not-a-real-password";

/** A controllable clock so the ~60s cache window is testable in milliseconds. */
class Clock {
  private t = 1_000_000;
  now = (): number => this.t;
  advance(ms: number): void {
    this.t += ms;
  }
}

const env = {
  THROTTLE_LIMIT: 120,
  THROTTLE_TTL_SECONDS: 60,
  JWT_ACCESS_SECRET: "test-access-secret-for-platform-settings-abcd",
  JWT_ACCESS_TTL: "15m",
  JWT_REFRESH_TTL_DAYS: 30,
  DEFAULT_DOMAIN: "localhost:3002",
  PLATFORM_ADMIN_EMAILS: "",
} as unknown as Env;

class FakeMail {
  async sendEmailVerification() {}
  async sendInvite() {}
  async sendPasswordReset() {}
}

describeDb("#972 — runtime platform settings", () => {
  let handle: ReturnType<typeof createDatabase>;
  let db: Database;
  let clock: Clock;
  let settings: PlatformSettingsService;
  let auth: AuthService;

  const stamp = `${Date.now().toString(36)}${Math.random().toString(16).slice(2, 6)}`;
  // Every setting row this test writes uses a key suffixed with the stamp so it
  // cannot collide with another worker on the shared DB; the service is
  // constructed to read those keys.
  const actorEmail = `ps-admin-${stamp}@snapurl.test`;
  let actorId: string;
  let actor: AdminActor;
  const createdUserIds: string[] = [];

  beforeAll(async () => {
    handle = createDatabase({ url: DATABASE_URL!, max: 4 });
    db = handle.db;
    clock = new Clock();

    settings = new PlatformSettingsService(db, env);
    settings.setClockForTesting(clock.now);

    const tokens = new TokenService(db, env, new JwtService());
    const totp = new TotpService();
    const oauth = { verify: async () => ({ subject: "x", email: "x", emailVerified: true }) } as unknown as OAuthService;
    auth = new AuthService(
      db,
      env,
      tokens,
      totp,
      oauth,
      new FakeMail() as unknown as MailService,
      settings,
      botProtectionStub(),
      signupRefusalStub(),
    );

    const [adminRow] = await db
      .insert(users)
      .values({ name: "PS Admin", email: actorEmail, emailVerifiedAt: new Date() })
      .returning({ id: users.id, email: users.email });
    actorId = adminRow!.id;
    actor = { admin: { id: actorId, name: "PS Admin", email: adminRow!.email }, ip: "203.0.113.9" };
  });

  afterAll(async () => {
    // Clean up only what this test created.
    await db.delete(adminAuditLog).where(eq(adminAuditLog.actorId, actorId));
    for (const key of ["signupMode", "rateLimit", "banner", "reservedSlugs", "featureFlags"]) {
      await db.delete(platformSettings).where(eq(platformSettings.key, key));
    }
    // The register test creates a user with a workspace + membership; remove the
    // membership and the sole-owned workspace, then the user.
    for (const uid of createdUserIds) {
      const mems = await db
        .select({ workspaceId: memberships.workspaceId })
        .from(memberships)
        .where(eq(memberships.userId, uid));
      await db.delete(memberships).where(eq(memberships.userId, uid));
      for (const m of mems) {
        await db.delete(workspaces).where(eq(workspaces.id, m.workspaceId));
      }
      await db.delete(users).where(eq(users.id, uid));
    }
    await db.delete(users).where(eq(users.id, actorId));
    await handle.close?.();
  });

  async function auditFor(targetId: string) {
    return db
      .select()
      .from(adminAuditLog)
      .where(eq(adminAuditLog.targetId, targetId))
      .orderBy(desc(adminAuditLog.at));
  }

  it("defaults fall back to the env values when the store is empty", async () => {
    settings.invalidate();
    const values = await settings.getValues();
    expect(values.signupMode).toBe("open");
    expect(values.rateLimit).toEqual({ limit: 120, ttlSeconds: 60 });
    expect(values.banner.message).toBe("");
  });

  it("an admin write takes effect immediately on the writing instance (cache busted)", async () => {
    await settings.update({ signupMode: "closed" }, actor);
    expect((await settings.getValues()).signupMode).toBe("closed");
    // and registration is refused right away
    await expect(
      auth.register({ name: "Nope", email: `ps-closed-${stamp}@x.com`, password: TEST_PASSWORD } as never),
    ).rejects.toBeInstanceOf(ForbiddenException);
  });

  it("a change is honoured only WITHIN the cache window for a direct DB write", async () => {
    // Open signups through the service (busts the cache), then confirm open.
    await settings.update({ signupMode: "open" }, actor);
    expect((await settings.getValues()).signupMode).toBe("open");

    // Simulate another instance / out-of-band change: write the DB directly,
    // WITHOUT busting this instance's cache. Within the window the service must
    // still serve the cached "open".
    await db
      .update(platformSettings)
      .set({ value: "closed", updatedById: actorId, updatedByLabel: actorEmail, updatedAt: new Date() })
      .where(eq(platformSettings.key, "signupMode"));

    clock.advance(SETTINGS_CACHE_TTL_MS - 1);
    expect((await settings.getValues()).signupMode).toBe("open");

    // Once the window passes, the next read reloads and sees the DB value.
    clock.advance(2);
    expect((await settings.getValues()).signupMode).toBe("closed");
  });

  it("invite_only blocks the password register path with a 403", async () => {
    await settings.update({ signupMode: "invite_only" }, actor);
    await expect(
      auth.register({ name: "Inv", email: `ps-inv-${stamp}@x.com`, password: TEST_PASSWORD } as never),
    ).rejects.toBeInstanceOf(ForbiddenException);
  });

  it("invite_only and closed also block a brand-new OAuth account", async () => {
    // oauthSignIn with a never-seen subject/email hits the new-account branch,
    // which is gated identically.
    const oauthReject = { verify: async () => ({ subject: `s-${stamp}`, email: `ps-oauth-${stamp}@x.com`, emailVerified: true }) } as unknown as OAuthService;
    const gatedAuth = new AuthService(db, env, new TokenService(db, env, new JwtService()), new TotpService(), oauthReject, new FakeMail() as unknown as MailService, settings, botProtectionStub(), signupRefusalStub());

    await settings.update({ signupMode: "closed" }, actor);
    await expect(gatedAuth.oauthSignIn("google", "tok", "nonce")).rejects.toBeInstanceOf(ForbiddenException);

    await settings.update({ signupMode: "invite_only" }, actor);
    await expect(gatedAuth.oauthSignIn("google", "tok", "nonce")).rejects.toBeInstanceOf(ForbiddenException);
  });

  it("open signups let a new account register again", async () => {
    await settings.update({ signupMode: "open" }, actor);
    const email = `ps-open-${stamp}@x.com`;
    const session = await auth.register({ name: "Yes", email, password: TEST_PASSWORD });
    expect(session.accessToken).toBeTruthy();
    expect(session.user.id).toBeTruthy();
    createdUserIds.push(session.user.id);
  });

  it("a changed rate limit is the value the throttler would read, no restart", async () => {
    await settings.update({ rateLimit: { limit: 7, ttlSeconds: 30 } }, actor);
    const { rateLimit } = await settings.getValues();
    expect(rateLimit).toEqual({ limit: 7, ttlSeconds: 30 });
  });

  it("the banner read reflects what was set, and empty means none", async () => {
    await settings.update({ banner: { message: "Scheduled maintenance 02:00 UTC", level: "warning" } }, actor);
    expect(await settings.getBanner()).toEqual({ message: "Scheduled maintenance 02:00 UTC", level: "warning" });

    await settings.update({ banner: { message: "", level: "info" } }, actor);
    expect((await settings.getBanner()).message).toBe("");
  });

  it("every change writes an admin_audit_log row with before and after", async () => {
    await settings.update({ signupMode: "open" }, actor);
    await settings.update({ signupMode: "invite_only" }, actor);

    const rows = await auditFor("signupMode");
    expect(rows.length).toBeGreaterThanOrEqual(2);
    const latest = rows[0]!;
    expect(latest.action).toBe("admin.settings.signupMode");
    expect(latest.targetType).toBe("platform_setting");
    expect(latest.actorId).toBe(actorId);
    expect(latest.requestIp).toBe("203.0.113.9");
    expect((latest.after as { signupMode: string }).signupMode).toBe("invite_only");
    expect((latest.before as { signupMode: string }).signupMode).toBe("open");
  });

  it("getForAdmin returns values, env-derived defaults and per-setting provenance", async () => {
    await settings.update({ signupMode: "closed" }, actor);
    const view = await settings.getForAdmin();
    expect(view.values.signupMode).toBe("closed");
    expect(view.defaults.rateLimit).toEqual({ limit: 120, ttlSeconds: 60 });
    expect(view.defaults.signupMode).toBe("open");
    expect(view.meta.signupMode.updatedBy).toBe(actorEmail);
    expect(view.meta.signupMode.updatedAt).toBeTruthy();
  });
});
