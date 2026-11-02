import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { JwtService } from "@nestjs/jwt";
import { BadRequestException, ForbiddenException, HttpException } from "@nestjs/common";
import { createDatabase, eq, links, memberships, users, workspaces, type Database } from "@snapurl/database";
import { effectiveGate } from "@snapurl/domain";
import { AuthService } from "./auth.service.js";
import { TokenService } from "./token.service.js";
import { LinksService } from "../links/links.service.js";
import { PostgresLinkResolver } from "../../../redirect/src/resolver.js";
import { openPlatformSettingsStub } from "../test/platform-settings.stub.js";
import { botProtectionStub, signupRefusalStub } from "../test/signup-controls.stub.js";
import { toActor } from "../common/activity.js";
import type { TotpService } from "./totp.service.js";
import type { OAuthService } from "./oauth.service.js";
import type { MailService } from "../mail/mail.service.js";
import type { SafeBrowsingService } from "../safe-browsing/safe-browsing.service.js";
import type { ProjectionNudgeService } from "../links/projection-nudge.service.js";
import type { LinkCacheBustService } from "../common/link-cache-bust.service.js";
import type { SignupRefusalService } from "./signup-refusal.service.js";
import type { PlatformSettingsValues } from "@snapurl/contract";
import type { Env } from "../config/env.js";
import { CreateLinkInput } from "@snapurl/contract";

/* ============================================================
   #993 — sign-up and account abuse controls, against a real Postgres.

   The acceptance criteria that only a real DB can prove:
     1. an unverified account's link does NOT redirect, and starts redirecting
        once the owner verifies (the edge gate reads the owner's live state, and
        verify re-projects the owner's links);
     2. the new-account caps refuse the N+1th link with a clear message, and an
        admin lift removes the cap;
     3. a sign-up with no/invalid bot-challenge token is refused when protection
        is on, and the refusal is recorded with its reason code;
     4. a disposable-domain sign-up is refused, recorded likewise.

   Runs only when DATABASE_URL is set (the shared compose/CI Postgres).
   ============================================================ */

const DATABASE_URL = process.env.DATABASE_URL;
const describeDb = DATABASE_URL ? describe : describe.skip;

const env = {
  JWT_ACCESS_SECRET: "test-access-secret-aaaaaaaaaaaaaaaaaaaa",
  JWT_REFRESH_SECRET: "test-refresh-secret-bbbbbbbbbbbbbbbbbbbb",
  JWT_ACCESS_TTL: "15m",
  JWT_REFRESH_TTL_DAYS: 30,
  DEFAULT_DOMAIN: "localhost:3002",
  BOT_PROTECTION_SECRET: "fake-test-secret-not-a-real-key",
} as unknown as Env;

const safeBrowsingStub = {
  check: async () => ({ status: "clean" as const, checkedAt: new Date() }),
} as unknown as SafeBrowsingService;
const projectionNudgeStub = { nudge: () => {} } as unknown as ProjectionNudgeService;
const cacheBustStub = { bust: async () => {} } as unknown as LinkCacheBustService;

class FakeMail {
  sent: Array<{ to: string; token: string }> = [];
  async sendEmailVerification(opts: { to: string; token: string }) {
    this.sent.push(opts);
  }
  async sendPasswordReset() {}
}

/** Build an AuthService whose platform settings and bot-protection behaviour
 *  this test controls. */
function makeAuth(
  db: Database,
  mail: FakeMail,
  opts: {
    settings?: Partial<PlatformSettingsValues>;
    botOk?: boolean;
    botReason?: "missing" | "failed";
    refusals?: SignupRefusalService;
  } = {},
) {
  const tokens = new TokenService(db, env, new JwtService());
  const botStub = botProtectionStub(
    opts.botOk === false ? { ok: false, reason: opts.botReason ?? "failed" } : { ok: true },
  );
  return new AuthService(
    db,
    env,
    tokens,
    {} as unknown as TotpService,
    {} as unknown as OAuthService,
    mail as unknown as MailService,
    openPlatformSettingsStub(opts.settings),
    botStub,
    opts.refusals ?? signupRefusalStub(),
  );
}

const createInput = (over: Partial<CreateLinkInput> = {}): CreateLinkInput =>
  CreateLinkInput.parse({ domain: "localhost:3002", destination: "https://example.com/dest", ...over });

describeDb("#993 sign-up and account abuse controls", () => {
  let handle: ReturnType<typeof createDatabase>;
  let db: Database;
  const stamp = Date.now();
  const createdUserIds: string[] = [];
  const createdWorkspaceIds: string[] = [];

  beforeAll(async () => {
    handle = createDatabase({ url: DATABASE_URL!, max: 1 });
    db = handle.db;
  });

  afterAll(async () => {
    // Links first (FK to workspace), one workspace at a time.
    for (const id of createdWorkspaceIds) await db.delete(links).where(eq(links.workspaceId, id));
    for (const id of createdUserIds) await db.delete(users).where(eq(users.id, id));
    for (const id of createdWorkspaceIds) await db.delete(workspaces).where(eq(workspaces.id, id));
    await handle.close?.();
  });

  /* ---- 3. bot-protection refusal ---- */

  it("refuses register with no challenge token when protection is on, and logs bot_challenge_missing", async () => {
    const refusals = signupRefusalStub();
    const auth = makeAuth(db, new FakeMail(), { botOk: false, botReason: "missing", refusals });
    const email = `bot-missing-${stamp}@example.com`;
    await expect(
      auth.register({ name: "Bot", email, password: "a-long-enough-password" }),
    ).rejects.toBeInstanceOf(ForbiddenException);
    expect(refusals.recorded.map((r) => r.reason)).toContain("bot_challenge_missing");
    // No account was created.
    const rows = await db.select({ id: users.id }).from(users).where(eq(users.email, email));
    expect(rows).toHaveLength(0);
  });

  it("refuses register with an invalid challenge token, logging bot_challenge_failed", async () => {
    const refusals = signupRefusalStub();
    const auth = makeAuth(db, new FakeMail(), { botOk: false, botReason: "failed", refusals });
    const email = `bot-failed-${stamp}@example.com`;
    await expect(
      auth.register({ name: "Bot", email, password: "a-long-enough-password", challengeToken: "bad" }),
    ).rejects.toBeInstanceOf(ForbiddenException);
    expect(refusals.recorded.map((r) => r.reason)).toContain("bot_challenge_failed");
  });

  it("allows register when the challenge passes (protection on, valid token)", async () => {
    const mail = new FakeMail();
    const auth = makeAuth(db, mail, { botOk: true });
    const email = `bot-ok-${stamp}@example.com`;
    const session = await auth.register({
      name: "Good Human",
      email,
      password: "a-long-enough-password",
      challengeToken: "good-token",
    });
    expect(session).toBeTruthy();
    const [u] = await db.select({ id: users.id }).from(users).where(eq(users.email, email));
    expect(u).toBeTruthy();
    createdUserIds.push(u!.id);
    const ms = await db.select({ workspaceId: memberships.workspaceId }).from(memberships).where(eq(memberships.userId, u!.id));
    for (const m of ms) createdWorkspaceIds.push(m.workspaceId);
  });

  /* ---- 4. disposable-email refusal ---- */

  it("refuses a disposable-domain sign-up and logs disposable_email", async () => {
    const refusals = signupRefusalStub();
    const auth = makeAuth(db, new FakeMail(), {
      settings: { disposableEmails: { extraDomains: [] } },
      refusals,
    });
    const email = `throwaway-${stamp}@mailinator.com`;
    await expect(
      auth.register({ name: "Spammer", email, password: "a-long-enough-password" }),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(refusals.recorded.map((r) => r.reason)).toContain("disposable_email");
    const rows = await db.select({ id: users.id }).from(users).where(eq(users.email, email));
    expect(rows).toHaveLength(0);
  });

  it("refuses a sign-up from an admin-added disposable domain not on the vendored list", async () => {
    const refusals = signupRefusalStub();
    const auth = makeAuth(db, new FakeMail(), {
      settings: { disposableEmails: { extraDomains: ["brand-new-throwaway.test"] } },
      refusals,
    });
    const email = `x-${stamp}@brand-new-throwaway.test`;
    await expect(
      auth.register({ name: "Spammer", email, password: "a-long-enough-password" }),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(refusals.recorded.map((r) => r.reason)).toContain("disposable_email");
  });

  /* ---- 1. unverified-owner edge gate + verify lifts it ---- */

  it("holds an unverified owner's link (gate=not_active) and releases it after verification", async () => {
    const mail = new FakeMail();
    const auth = makeAuth(db, mail, { botOk: true });
    const resolver = new PostgresLinkResolver(db);
    const links_ = new LinksService(
      db,
      db,
      safeBrowsingStub,
      projectionNudgeStub,
      cacheBustStub,
      openPlatformSettingsStub(),
      signupRefusalStub(),
    );

    const email = `unverified-owner-${stamp}@example.com`;
    await auth.register({ name: "Fresh Owner", email, password: "a-long-enough-password" });
    const [u] = await db.select({ id: users.id }).from(users).where(eq(users.email, email));
    createdUserIds.push(u!.id);
    const [m] = await db
      .select({ workspaceId: memberships.workspaceId })
      .from(memberships)
      .where(eq(memberships.userId, u!.id));
    const workspaceId = m!.workspaceId;
    createdWorkspaceIds.push(workspaceId);

    const slug = `held-${stamp}`;
    const link = await links_.create(workspaceId, toActor({ userId: u!.id, label: email }), createInput({ slug }));

    // While the owner is unverified, the resolver reports the link held and the
    // gate refuses it (not_active) — it does NOT redirect.
    const held = await resolver.resolve("localhost:3002", link.slug);
    expect(held).toBeTruthy();
    expect(held!.ownerUnverified).toBe(true);
    expect(effectiveGate(held!)).toBe("not_active");

    // Verify the owner's email (resend issues a fresh token we can consume).
    await auth.resendEmailVerification(email);
    const token = mail.sent.at(-1)!.token;
    await auth.verifyEmail(token);

    // Now the resolver reports the link live and the gate lets it through.
    const live = await resolver.resolve("localhost:3002", link.slug);
    expect(live!.ownerUnverified).toBe(false);
    expect(effectiveGate(live!)).toBeNull();
  });

  /* ---- 2. new-account caps + admin lift ---- */

  it("refuses the N+1th link in the per-hour window for a new account, and an admin lift removes the cap", async () => {
    // A verified owner (so the ownerUnverified gate is not what's being tested),
    // on a brand-new workspace, with a tiny per-hour cap.
    const email = `capped-${stamp}@example.com`;
    const [u] = await db
      .insert(users)
      .values({ name: "Capped", email, emailVerifiedAt: new Date() })
      .returning({ id: users.id });
    createdUserIds.push(u!.id);
    const [ws] = await db
      .insert(workspaces)
      .values({ name: "Capped WS", slug: `capped-${stamp}` })
      .returning({ id: workspaces.id });
    const workspaceId = ws!.id;
    createdWorkspaceIds.push(workspaceId);
    await db.insert(memberships).values({
      workspaceId,
      userId: u!.id,
      email,
      role: "owner",
      status: "active",
      acceptedAt: new Date(),
    });

    // A per-hour cap of 2 (perDay generous so the hour cap is what trips).
    const capped = new LinksService(
      db,
      db,
      safeBrowsingStub,
      projectionNudgeStub,
      cacheBustStub,
      openPlatformSettingsStub({ newAccountLimits: { windowDays: 7, perDay: 1000, perHour: 2 } }),
      signupRefusalStub(),
    );
    const actor = toActor({ userId: u!.id, label: email });

    await capped.create(workspaceId, actor, createInput({ slug: `cap-a-${stamp}` }));
    await capped.create(workspaceId, actor, createInput({ slug: `cap-b-${stamp}` }));
    // The 3rd (N+1) is refused with a 429 HttpException.
    await expect(capped.create(workspaceId, actor, createInput({ slug: `cap-c-${stamp}` }))).rejects.toSatisfy(
      (e: unknown) => e instanceof HttpException && (e as HttpException).getStatus() === 429,
    );

    // An admin lifts the caps for this workspace.
    await db
      .update(workspaces)
      .set({ newAccountLimitsLiftedAt: new Date() })
      .where(eq(workspaces.id, workspaceId));

    // Now the same create succeeds.
    const after = await capped.create(workspaceId, actor, createInput({ slug: `cap-d-${stamp}` }));
    expect(after.slug).toBe(`cap-d-${stamp}`);
  });

  it("does not cap a workspace older than the new-account window", async () => {
    const email = `old-ws-${stamp}@example.com`;
    const [u] = await db
      .insert(users)
      .values({ name: "Old", email, emailVerifiedAt: new Date() })
      .returning({ id: users.id });
    createdUserIds.push(u!.id);
    // Created 30 days ago — well outside a 7-day window.
    const [ws] = await db
      .insert(workspaces)
      .values({ name: "Old WS", slug: `old-ws-${stamp}`, createdAt: new Date(Date.now() - 30 * 86_400_000) })
      .returning({ id: workspaces.id });
    const workspaceId = ws!.id;
    createdWorkspaceIds.push(workspaceId);
    await db.insert(memberships).values({
      workspaceId,
      userId: u!.id,
      email,
      role: "owner",
      status: "active",
      acceptedAt: new Date(),
    });

    const svc = new LinksService(
      db,
      db,
      safeBrowsingStub,
      projectionNudgeStub,
      cacheBustStub,
      openPlatformSettingsStub({ newAccountLimits: { windowDays: 7, perDay: 1, perHour: 1 } }),
      signupRefusalStub(),
    );
    const actor = toActor({ userId: u!.id, label: email });
    // Even with a cap of 1/1, an old workspace is not capped: both succeed.
    await svc.create(workspaceId, actor, createInput({ slug: `old-a-${stamp}` }));
    const second = await svc.create(workspaceId, actor, createInput({ slug: `old-b-${stamp}` }));
    expect(second.slug).toBe(`old-b-${stamp}`);
  });
});
