import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { ConflictException, ForbiddenException, GoneException, HttpException, NotFoundException } from "@nestjs/common";
import { JwtService } from "@nestjs/jwt";
import { and, auditLog, createDatabase, eq, inArray, memberships, sql, users, workspaces, type Database } from "@snapurl/database";
import { AuthService, INVITE_TTL_MS } from "./auth.service.js";
import { TokenService } from "./token.service.js";
import type { TotpService } from "./totp.service.js";
import type { OAuthService } from "./oauth.service.js";
import type { MailService } from "../mail/mail.service.js";
import { MembersService } from "../members/members.service.js";
import type { Env } from "../config/env.js";

/* ============================================================
   #668 — accepting a team invitation, against a real Postgres.

   Every refusal the accept route can give is asserted by its status class
   AND its stable `code`, because the /invite page branches on the code.
   Single use is asserted under a real concurrent race, which only Postgres
   evaluating the guarded UPDATE can show. The workspace binding (refresh
   hint, deterministic default, switcher) is asserted here too: without it an
   accepted invitation is not reachable for longer than one access token.

   Runs only when DATABASE_URL is set (compose CI harness).
   ============================================================ */

const DATABASE_URL = process.env.DATABASE_URL;
const describeDb = DATABASE_URL ? describe : describe.skip;

class FakeMail {
  invites: Array<{ to: string; token: string }> = [];
  async sendInvite(opts: { to: string; token: string; invitedBy: string }) {
    this.invites.push({ to: opts.to, token: opts.token });
  }
  async sendEmailVerification() {}
}

const env = {
  JWT_ACCESS_SECRET: "test-access-secret-for-invite-accept",
  JWT_ACCESS_TTL: "15m",
  JWT_REFRESH_TTL_DAYS: 30,
  DEFAULT_DOMAIN: "localhost:3002",
} as unknown as Env;

const PASSWORD = "invite-accept-password-123";

async function expectRefusal(p: Promise<unknown>, Exc: typeof HttpException, code: string) {
  const err = await p.then(
    () => {
      throw new Error(`expected ${code}, but the call succeeded`);
    },
    (e: unknown) => e,
  );
  expect(err).toBeInstanceOf(Exc);
  expect((err as HttpException).getResponse()).toMatchObject({ code });
}

function claims(accessToken: string): { sub: string; wid: string; role: string } {
  return JSON.parse(Buffer.from(accessToken.split(".")[1]!, "base64url").toString());
}

describeDb("AuthService.acceptInvite (#668)", () => {
  let handle: ReturnType<typeof createDatabase>;
  let db: Database;
  let tokens: TokenService;
  let mail: FakeMail;
  let auth: AuthService;
  let members: MembersService;

  const stamp = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const userIds: string[] = [];
  const workspaceIds: string[] = [];

  let ownerWid: string;

  async function newUser(tag: string, verified = true) {
    const email = `invite-${tag}-${stamp}@example.com`;
    const session = await auth.register({ name: `Invite ${tag}`, email, password: PASSWORD });
    userIds.push(session.user.id);
    workspaceIds.push(claims(session.accessToken).wid);
    if (verified) await db.update(users).set({ emailVerifiedAt: new Date() }).where(eq(users.id, session.user.id));
    return { ...session, email, wid: claims(session.accessToken).wid };
  }

  async function invite(email: string, role: "admin" | "editor" | "viewer" = "viewer") {
    await members.invite(ownerWid, "owner@example.com", { email, role });
    return mail.invites.at(-1)!.token;
  }

  async function row(email: string) {
    const [r] = await db
      .select()
      .from(memberships)
      .where(and(eq(memberships.workspaceId, ownerWid), sql`lower(${memberships.email}) = ${email.toLowerCase()}`));
    return r!;
  }

  beforeAll(async () => {
    handle = createDatabase({ url: DATABASE_URL!, max: 4 });
    db = handle.db;
    tokens = new TokenService(db, env, new JwtService());
    mail = new FakeMail();
    auth = new AuthService(db, env, tokens, {} as TotpService, {} as OAuthService, mail as unknown as MailService);
    members = new MembersService(db, db, mail as unknown as MailService);
    const owner = await newUser("owner");
    ownerWid = owner.wid;
  });

  afterAll(async () => {
    if (workspaceIds.length) await db.delete(workspaces).where(inArray(workspaces.id, workspaceIds));
    if (userIds.length) await db.delete(users).where(inArray(users.id, userIds));
    await handle.close?.();
  });

  it("happy path: activates the row, binds the user, reports the joined workspace with the invited role — and mints no token", async () => {
    const invitee = await newUser("happy");
    const token = await invite(invitee.email, "viewer");
    expect((await row(invitee.email)).status).toBe("invited");

    const accepted = await auth.acceptInvite(invitee.user.id, token);

    expect(accepted.workspaceId).toBe(ownerWid);
    expect(accepted.user.role).toBe("viewer");
    // #699 — entering the workspace is a refresh, never a token from accept.
    expect(JSON.stringify(accepted)).not.toMatch(/eyJ[\w-]+\.[\w-]+\.[\w-]+/);
    const entered = await auth.refresh(invitee.refreshToken, undefined, accepted.workspaceId);
    expect(claims(entered.accessToken)).toMatchObject({ sub: invitee.user.id, wid: ownerWid, role: "viewer" });

    const r = await row(invitee.email);
    expect(r).toMatchObject({ status: "active", userId: invitee.user.id, role: "viewer" });
    expect(r.acceptedAt).toBeInstanceOf(Date);

    const list = await members.list(ownerWid);
    expect(list.find((m) => m.email === invitee.email)).toMatchObject({ status: "active", role: "viewer" });

    const audit = await db.select().from(auditLog).where(and(eq(auditLog.workspaceId, ownerWid), eq(auditLog.action, "member.joined")));
    expect(audit.some((a) => a.targetId === r.id)).toBe(true);
  });

  it("an already-accepted token is refused (single use)", async () => {
    const invitee = await newUser("reuse");
    const token = await invite(invitee.email);
    await auth.acceptInvite(invitee.user.id, token);
    await expectRefusal(auth.acceptInvite(invitee.user.id, token), ConflictException, "invite_used");
  });

  it("two concurrent accepts of one token: exactly one wins", async () => {
    const invitee = await newUser("race");
    const token = await invite(invitee.email);
    const results = await Promise.allSettled([
      auth.acceptInvite(invitee.user.id, token),
      auth.acceptInvite(invitee.user.id, token),
      auth.acceptInvite(invitee.user.id, token),
    ]);
    expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
    for (const r of results.filter((x) => x.status === "rejected")) {
      expect((r as PromiseRejectedResult).reason).toBeInstanceOf(ConflictException);
    }
  });

  it("an unknown or malformed token is invite_invalid", async () => {
    const invitee = await newUser("invalid");
    await expectRefusal(auth.acceptInvite(invitee.user.id, "not-a-real-token"), NotFoundException, "invite_invalid");
    await expectRefusal(auth.acceptInvite(invitee.user.id, "x".repeat(43)), NotFoundException, "invite_invalid");
  });

  it("an invitation older than 7 days is invite_expired and stays unaccepted", async () => {
    const invitee = await newUser("expired");
    const token = await invite(invitee.email);
    await db
      .update(memberships)
      .set({ invitedAt: new Date(Date.now() - INVITE_TTL_MS - 60_000) })
      .where(eq(memberships.id, (await row(invitee.email)).id));
    await expectRefusal(auth.acceptInvite(invitee.user.id, token), GoneException, "invite_expired");
    expect((await row(invitee.email)).status).toBe("invited");
  });

  it("just inside 7 days is still accepted", async () => {
    const invitee = await newUser("edge");
    const token = await invite(invitee.email);
    await db
      .update(memberships)
      .set({ invitedAt: new Date(Date.now() - INVITE_TTL_MS + 60_000) })
      .where(eq(memberships.id, (await row(invitee.email)).id));
    await expect(auth.acceptInvite(invitee.user.id, token)).resolves.toMatchObject({ workspaceId: ownerWid });
  });

  it("a different signed-in account is invite_email_mismatch, and the invite stays usable by the right person", async () => {
    const invitee = await newUser("intended");
    const stranger = await newUser("stranger");
    const token = await invite(invitee.email);
    await expectRefusal(auth.acceptInvite(stranger.user.id, token), ForbiddenException, "invite_email_mismatch");
    expect((await row(invitee.email)).status).toBe("invited");
    await expect(auth.acceptInvite(invitee.user.id, token)).resolves.toMatchObject({ workspaceId: ownerWid });
  });

  it("the email match is case-insensitive", async () => {
    const invitee = await newUser("casing");
    const token = await invite(invitee.email.toUpperCase());
    await expect(auth.acceptInvite(invitee.user.id, token)).resolves.toMatchObject({ workspaceId: ownerWid });
  });

  it("an unverified account is email_unverified until it verifies", async () => {
    const invitee = await newUser("unverified", false);
    const token = await invite(invitee.email);
    await expectRefusal(auth.acceptInvite(invitee.user.id, token), ForbiddenException, "email_unverified");
    expect((await row(invitee.email)).status).toBe("invited");
    await db.update(users).set({ emailVerifiedAt: new Date() }).where(eq(users.id, invitee.user.id));
    await expect(auth.acceptInvite(invitee.user.id, token)).resolves.toMatchObject({ workspaceId: ownerWid });
  });

  it("a user already active in the workspace is already_member", async () => {
    const invitee = await newUser("member");
    const token = await invite(invitee.email);
    // Already active in the workspace under another membership row.
    await db.insert(memberships).values({
      workspaceId: ownerWid,
      userId: invitee.user.id,
      email: `alias-${stamp}@example.com`,
      role: "editor",
      status: "active",
      acceptedAt: new Date(),
    });
    await expectRefusal(auth.acceptInvite(invitee.user.id, token), ConflictException, "already_member");
  });

  it("refresh keeps the joined workspace when hinted, defaults to the personal one, and ignores a hint it cannot honour", async () => {
    const invitee = await newUser("refresh");
    const token = await invite(invitee.email, "editor");
    await auth.acceptInvite(invitee.user.id, token);

    const kept = await auth.refresh(invitee.refreshToken, undefined, ownerWid);
    expect(claims(kept.accessToken)).toMatchObject({ wid: ownerWid, role: "editor" });

    const fallback = await auth.refresh(kept.refreshToken);
    expect(claims(fallback.accessToken)).toMatchObject({ wid: invitee.wid, role: "owner" });

    const stranger = await newUser("not-mine");
    const ignored = await auth.refresh(fallback.refreshToken, undefined, stranger.wid);
    expect(claims(ignored.accessToken).wid).toBe(invitee.wid);

    // Sign-in is deterministic: always the personal (first-joined) workspace.
    for (let i = 0; i < 3; i++) {
      const login = await auth.login({ email: invitee.email, password: PASSWORD });
      expect("accessToken" in login && claims(login.accessToken).wid).toBe(invitee.wid);
    }

    // A role change in the joined workspace lands on the next hinted refresh.
    await db.update(memberships).set({ role: "viewer" }).where(eq(memberships.id, (await row(invitee.email)).id));
    const demoted = await auth.refresh(ignored.refreshToken, undefined, ownerWid);
    expect(claims(demoted.accessToken)).toMatchObject({ wid: ownerWid, role: "viewer" });

    // Removal moves them out on the next refresh.
    await db.delete(memberships).where(eq(memberships.id, (await row(invitee.email)).id));
    const removed = await auth.refresh(demoted.refreshToken, undefined, ownerWid);
    expect(claims(removed.accessToken).wid).toBe(invitee.wid);
  });

  it("the switcher lists active workspaces, and switching is a hinted refresh that refuses one the user is not in", async () => {
    const invitee = await newUser("switch");
    const token = await invite(invitee.email, "admin");
    await auth.acceptInvite(invitee.user.id, token);

    const list = await auth.listWorkspaces(invitee.user.id, invitee.wid);
    expect(list.map((w) => [w.id, w.role, w.current])).toEqual([
      [invitee.wid, "owner", true],
      [ownerWid, "admin", false],
    ]);

    // #699 — switching goes through refresh (rotation + revocation).
    const switched = await auth.refresh(invitee.refreshToken, undefined, ownerWid);
    expect(claims(switched.accessToken)).toMatchObject({ wid: ownerWid, role: "admin" });
    expect((await auth.me(invitee.user.id, ownerWid, "admin")).role).toBe("admin");
    expect((await auth.me(invitee.user.id, invitee.wid, "owner")).role).toBe("owner");

    // A workspace the user is not in is not honoured: the claims stay in their own.
    const stranger = await newUser("switch-stranger");
    const refused = await auth.refresh(switched.refreshToken, undefined, stranger.wid);
    expect(claims(refused.accessToken).wid).toBe(invitee.wid);
  });

  it("a still-pending invitation is not a membership: it cannot be switched into", async () => {
    const invitee = await newUser("pending");
    await invite(invitee.email);
    const hinted = await auth.refresh(invitee.refreshToken, undefined, ownerWid);
    expect(claims(hinted.accessToken).wid).toBe(invitee.wid);
    expect((await auth.listWorkspaces(invitee.user.id, invitee.wid)).map((w) => w.id)).toEqual([invitee.wid]);
  });
});
