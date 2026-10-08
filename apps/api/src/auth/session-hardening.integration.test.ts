import "reflect-metadata";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { ConflictException, HttpException, NotFoundException, UnauthorizedException } from "@nestjs/common";
import { METHOD_METADATA, PATH_METADATA } from "@nestjs/common/constants";
import { JwtService } from "@nestjs/jwt";
import {
  and,
  createDatabase,
  domains,
  eq,
  inArray,
  links,
  memberships,
  sql,
  users,
  workspaces,
  type Database,
} from "@snapurl/database";
import { AuthController } from "./auth.controller.js";
import { IS_PUBLIC } from "./auth.guard.js";
import { AuthService } from "./auth.service.js";
import { TokenService } from "./token.service.js";
import type { TotpService } from "./totp.service.js";
import type { OAuthService } from "./oauth.service.js";
import type { MailService } from "../mail/mail.service.js";
import { MembersService } from "../members/members.service.js";
import type { Env } from "../config/env.js";

/* ============================================================
   #699 — follow-ups to #668 (team invitations + workspace switching).

   The invariant behind the blocker: an access token must never be enough to
   obtain another access token. Only the refresh path checks the refresh-token
   family, so only it (plus the sign-in routes, which check a credential) may
   mint one. Otherwise "sign out everywhere" and a password reset stop working:
   a leaked access token renews itself forever.

   The first block pins that invariant mechanically — over the controller's
   routes and over every call site that signs an access token — so a new
   route that mints from an access token fails here rather than in review.
   The DB block proves the behaviour end to end against real Postgres.
   ============================================================ */

const JWT_RE = /eyJ[\w-]+\.[\w-]+\.[\w-]+/;

describe("no access token from an access token (#699, mechanical)", () => {
  /** Every route on AuthController that authenticates with an access token. */
  function authenticatedRoutes(): string[] {
    const proto = AuthController.prototype as unknown as Record<string, unknown>;
    return Object.getOwnPropertyNames(proto)
      .filter((name) => name !== "constructor" && typeof proto[name] === "function")
      .filter((name) => Reflect.getMetadata(PATH_METADATA, proto[name] as object) !== undefined)
      .filter((name) => !Reflect.getMetadata(IS_PUBLIC, proto[name] as object))
      .map((name) => {
        const fn = proto[name] as object;
        const method = ["GET", "POST", "PUT", "DELETE", "PATCH"][Reflect.getMetadata(METHOD_METADATA, fn) as number];
        return `${method} /auth/${Reflect.getMetadata(PATH_METADATA, fn) as string}`;
      })
      .sort();
  }

  it("the access-token-authenticated auth routes are exactly the known set, none of which issues a token", () => {
    /* Adding to this list is a security decision: the new route must not
       return an access or refresh token. POST /auth/workspace used to be here
       and did exactly that. */
    expect(authenticatedRoutes()).toEqual(
      [
        "GET /auth/me",
        "GET /auth/workspaces",
        "POST /auth/2fa/disable",
        "POST /auth/2fa/enable",
        "POST /auth/2fa/setup",
        "POST /auth/invite/accept",
      ].sort(),
    );
  });

  it("AuthService signs access tokens only in refresh() and issueSession()", () => {
    const src = readFileSync(fileURLToPath(new URL("./auth.service.ts", import.meta.url)), "utf8");
    const lines = src.split("\n");
    const owners: string[] = [];
    lines.forEach((line, i) => {
      if (!line.includes("signAccessToken(")) return;
      for (let j = i; j >= 0; j--) {
        const m = /^ {2}(?:private |public )?(?:async )?(\w+)\(/.exec(lines[j]!);
        if (m) {
          owners.push(m[1]!);
          break;
        }
      }
    });
    expect(owners.sort()).toEqual(["issueSession", "refresh"]);
  });
});

const DATABASE_URL = process.env.DATABASE_URL;
const describeDb = DATABASE_URL ? describe : describe.skip;

class FakeMail {
  invites: Array<{ to: string; token: string }> = [];
  async sendInvite(opts: { to: string; token: string }) {
    this.invites.push({ to: opts.to, token: opts.token });
  }
  async sendEmailVerification() {}
}

const env = {
  JWT_ACCESS_SECRET: "test-access-secret-for-session-hardening",
  JWT_ACCESS_TTL: "15m",
  JWT_REFRESH_TTL_DAYS: 30,
  DEFAULT_DOMAIN: "localhost:3002",
} as unknown as Env;

const PASSWORD = "session-hardening-password-123";

function claims(accessToken: string): { sub: string; wid: string; role: string } {
  return JSON.parse(Buffer.from(accessToken.split(".")[1]!, "base64url").toString());
}

async function codeOf(p: Promise<unknown>): Promise<{ err: unknown; code?: string }> {
  const err = await p.then(
    () => {
      throw new Error("expected a refusal, but the call succeeded");
    },
    (e: unknown) => e,
  );
  const body = err instanceof HttpException ? (err.getResponse() as { code?: string }) : undefined;
  return { err, code: body?.code };
}

describeDb("#699 — session revocation, membership drift, team scoping, accept robustness", () => {
  let handle: ReturnType<typeof createDatabase>;
  let locker: ReturnType<typeof createDatabase>;
  let db: Database;
  let tokens: TokenService;
  let mail: FakeMail;
  let auth: AuthService;
  let members: MembersService;

  const stamp = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const userIds: string[] = [];
  const workspaceIds: string[] = [];
  let owner: Awaited<ReturnType<typeof newUser>>;

  async function newUser(tag: string) {
    const email = `h699-${tag}-${stamp}@example.com`;
    const session = await auth.register({ name: `H ${tag}`, email, password: PASSWORD });
    userIds.push(session.user.id);
    const wid = claims(session.accessToken).wid;
    workspaceIds.push(wid);
    await db.update(users).set({ emailVerifiedAt: new Date() }).where(eq(users.id, session.user.id));
    return { ...session, email, wid };
  }

  async function inviteToken(email: string, role: "admin" | "editor" | "viewer" = "editor") {
    await members.invite(owner.wid, "owner@example.com", { email, role });
    return mail.invites.at(-1)!.token;
  }

  async function rowFor(email: string) {
    const [r] = await db
      .select()
      .from(memberships)
      .where(and(eq(memberships.workspaceId, owner.wid), sql`lower(${memberships.email}) = ${email.toLowerCase()}`));
    return r;
  }

  beforeAll(async () => {
    handle = createDatabase({ url: DATABASE_URL!, max: 4 });
    locker = createDatabase({ url: DATABASE_URL!, max: 1 });
    db = handle.db;
    tokens = new TokenService(db, env, new JwtService());
    mail = new FakeMail();
    auth = new AuthService(db, env, tokens, {} as TotpService, {} as OAuthService, mail as unknown as MailService);
    members = new MembersService(db, db, mail as unknown as MailService);
    owner = await newUser("owner");
  });

  afterAll(async () => {
    if (workspaceIds.length) await db.delete(workspaces).where(inArray(workspaces.id, workspaceIds));
    if (userIds.length) await db.delete(users).where(inArray(users.id, userIds));
    await locker.close?.();
    await handle.close?.();
  });

  it("BLOCKER: after sign-out everywhere, nothing an access token can reach yields a new access token", async () => {
    const victim = await newUser("revoked");
    const inviteFor = await inviteToken(victim.email);
    await auth.logout(victim.refreshToken, true);
    await expect(auth.refresh(victim.refreshToken, undefined, owner.wid)).rejects.toBeInstanceOf(UnauthorizedException);

    /* Everything the access-token routes on AuthController call. A leaked
       access token is still accepted by the guard until it expires, so each
       of these runs here as that token would make it run. None may hand back
       a token. (POST /auth/workspace's switchWorkspace() did, before #699.) */
    const svc = auth as unknown as Record<string, ((...a: unknown[]) => Promise<unknown>) | undefined>;
    const results: unknown[] = [
      await auth.me(victim.user.id, victim.wid, "owner"),
      await auth.listWorkspaces(victim.user.id, victim.wid),
      await auth.acceptInvite(victim.user.id, inviteFor),
    ];
    if (typeof svc.switchWorkspace === "function") {
      results.push(await svc.switchWorkspace.call(auth, victim.user.id, victim.wid).catch((e: unknown) => e));
    }
    for (const r of results) expect(JSON.stringify(r)).not.toMatch(JWT_RE);

    // And the revoked refresh token still cannot enter the joined workspace.
    await expect(auth.refresh(victim.refreshToken, undefined, owner.wid)).rejects.toBeInstanceOf(UnauthorizedException);
  });

  it("BLOCKER: a password reset revokes the session for workspace entry too", async () => {
    const victim = await newUser("reset");
    await tokens.revokeAllForUser(victim.user.id); // what confirmPasswordReset does
    await expect(auth.refresh(victim.refreshToken, undefined, victim.wid)).rejects.toBeInstanceOf(UnauthorizedException);
  });

  it("GET /auth/me is 401 when the token's membership is gone or its role changed, so the client refreshes", async () => {
    const m = await newUser("me-drift");
    await auth.acceptInvite(m.user.id, await inviteToken(m.email, "editor"));
    expect((await auth.me(m.user.id, owner.wid, "editor")).role).toBe("editor");

    // Demoted: the token still says editor.
    await db.update(memberships).set({ role: "viewer" }).where(eq(memberships.id, (await rowFor(m.email))!.id));
    await expect(auth.me(m.user.id, owner.wid, "editor")).rejects.toBeInstanceOf(UnauthorizedException);

    // Removed: previously answered with the personal workspace's owner role.
    await db.delete(memberships).where(eq(memberships.id, (await rowFor(m.email))!.id));
    await expect(auth.me(m.user.id, owner.wid, "viewer")).rejects.toBeInstanceOf(UnauthorizedException);

    // Their own workspace is unaffected.
    expect((await auth.me(m.user.id, m.wid, "owner")).role).toBe("owner");
  });

  it("the team page's link count and last-active are scoped to the workspace", async () => {
    const m = await newUser("scoped");
    await auth.acceptInvite(m.user.id, await inviteToken(m.email));
    const [domain] = await db.select({ id: domains.id }).from(domains).limit(1);
    // Three links in their personal workspace, one in the shared one.
    await db.insert(links).values([
      ...[1, 2, 3].map((i) => ({
        workspaceId: m.wid,
        domainId: domain!.id,
        slug: `h699-p${i}-${stamp}`.slice(0, 64),
        destination: "https://example.com/",
        createdBy: m.user.id,
      })),
      {
        workspaceId: owner.wid,
        domainId: domain!.id,
        slug: `h699-s-${stamp}`.slice(0, 64),
        destination: "https://example.com/",
        createdBy: m.user.id,
      },
    ]);

    // Active only in their personal workspace so far.
    await auth.me(m.user.id, m.wid, "owner");
    let row = (await members.list(owner.wid)).find((x) => x.email === m.email)!;
    expect(row.links).toBe(1);
    expect(row.lastActive).toBeNull();

    await auth.me(m.user.id, owner.wid, "editor");
    row = (await members.list(owner.wid)).find((x) => x.email === m.email)!;
    expect(row.lastActive).not.toBeNull();
  });

  it("an invitation revoked while it is being accepted is invite_invalid, not 'already accepted'", async () => {
    const m = await newUser("revoke-race");
    const token = await inviteToken(m.email);
    const inviteRow = (await rowFor(m.email))!;

    let accept!: Promise<unknown>;
    await locker.db.transaction(async (tx) => {
      // Hold the row so accept's guarded UPDATE has to wait for the revoke.
      await tx.execute(sql`select 1 from memberships where id = ${inviteRow.id} for update`);
      accept = auth.acceptInvite(m.user.id, token).then(
        (v) => v,
        (e: unknown) => {
          throw e;
        },
      );
      accept.catch(() => {});
      await new Promise((r) => setTimeout(r, 400));
      await tx.delete(memberships).where(eq(memberships.id, inviteRow.id));
    });

    const { err, code } = await codeOf(accept);
    expect(err).toBeInstanceOf(NotFoundException);
    expect(code).toBe("invite_invalid");
  });

  it("activation and its audit row are one transaction: a failed audit leaves the invitation unaccepted", async () => {
    const m = await newUser("atomic");
    const token = await inviteToken(m.email);
    const inviteRow = (await rowFor(m.email))!;
    const fn = `h699_fail_audit_${stamp.replace(/\W/g, "_")}`;
    const trg = `${fn}_trg`;
    await db.execute(
      sql.raw(`create function ${fn}() returns trigger language plpgsql as $$
        begin
          if new.target_id = '${inviteRow.id}' then raise exception 'h699 audit failure'; end if;
          return new;
        end $$`),
    );
    await db.execute(sql.raw(`create trigger ${trg} before insert on audit_log for each row execute function ${fn}()`));
    try {
      await expect(auth.acceptInvite(m.user.id, token)).rejects.toThrow();
    } finally {
      await db.execute(sql.raw(`drop trigger if exists ${trg} on audit_log`));
      await db.execute(sql.raw(`drop function if exists ${fn}()`));
    }
    expect((await rowFor(m.email))!.status).toBe("invited");
    // And it can still be accepted once the audit write works.
    await expect(auth.acceptInvite(m.user.id, token)).resolves.toMatchObject({ workspaceId: owner.wid });
  });

  it("a concurrent second accept still reports invite_used", async () => {
    const m = await newUser("race2");
    const token = await inviteToken(m.email);
    const results = await Promise.allSettled([auth.acceptInvite(m.user.id, token), auth.acceptInvite(m.user.id, token)]);
    const rejected = results.filter((r): r is PromiseRejectedResult => r.status === "rejected");
    expect(rejected).toHaveLength(1);
    expect(rejected[0]!.reason).toBeInstanceOf(ConflictException);
  });

  it("invite_token_hash is indexed", async () => {
    const r = await db.execute(
      sql`select indexdef from pg_indexes where tablename = 'memberships' and indexname = 'memberships_invite_token_hash_idx'`,
    );
    const rows = (r as unknown as { rows?: unknown[] }).rows ?? (r as unknown as unknown[]);
    expect(rows.length).toBe(1);
  });
});
