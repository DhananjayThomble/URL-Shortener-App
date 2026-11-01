import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { ExecutionContext, ForbiddenException } from "@nestjs/common";
import {
  adminAuditLog,
  createDatabase,
  eq,
  inArray,
  users,
  writeAdminAuditEntry,
  type Database,
} from "@snapurl/database";
import type { RequestActor } from "../auth/auth.guard.js";
import type { Env } from "../config/env.js";
import { AdminService } from "./admin.service.js";
import { AdminGuard } from "./admin.guard.js";

/* ============================================================
   #968 — the platform-admin check.

   The role is derived, never granted: a user is a platform admin only if their
   VERIFIED email is in PLATFORM_ADMIN_EMAILS (case-insensitive) AND 2FA is on.
   These cases prove each of the three conditions is load-bearing — flipping any
   one off turns an otherwise-admin away — and that an admin write lands an
   append-only audit row. Fails closed on every miss.

   Runs only when DATABASE_URL is set (DB-gated like the other integration
   suites), so a clean clone with no Postgres skips rather than erroring.
   ============================================================ */

const DATABASE_URL = process.env.DATABASE_URL;
const describeDb = DATABASE_URL ? describe : describe.skip;

const ADMIN_EMAIL_DOMAIN = "admin968.example.com";

/** A minimal Env carrying just what AdminService / AdminGuard read: the admin
 *  allowlist and the trusted-proxy hop count for the guard's IP resolution. */
function envWith(adminEmails: string): Env {
  return {
    PLATFORM_ADMIN_EMAILS: adminEmails,
    TRUSTED_PROXY_HOPS: 0,
  } as unknown as Env;
}

/** A fake ExecutionContext whose request carries the given actor, plus optional
 *  headers/socket so the guard can resolve a client IP. */
function ctxFor(actor: RequestActor | undefined, extra: Record<string, unknown> = {}): ExecutionContext {
  const request = { actor, headers: {}, raw: { socket: { remoteAddress: "203.0.113.7" } }, ip: "203.0.113.7", ...extra };
  return {
    switchToHttp: () => ({ getRequest: () => request }),
  } as unknown as ExecutionContext;
}

describeDb("platform-admin check (#968)", () => {
  let handle: ReturnType<typeof createDatabase>;
  let db: Database;

  const stamp = `${Date.now().toString(36)}${Math.random().toString(16).slice(2, 6)}`;
  const userIds: string[] = [];

  interface SeedOpts {
    verified?: boolean;
    twoFactor?: boolean;
  }

  /** Insert a user row directly (the admin check reads only `users`, so there
   *  is no need to stand up a workspace). Email is unique per call. */
  async function newUser(tag: string, opts: SeedOpts = {}): Promise<{ id: string; email: string }> {
    const email = `${tag}-${stamp}@${ADMIN_EMAIL_DOMAIN}`;
    const [row] = await db
      .insert(users)
      .values({
        name: `User ${tag}`,
        email,
        emailVerifiedAt: opts.verified ? new Date() : null,
        totpEnabledAt: opts.twoFactor ? new Date() : null,
        totpSecret: opts.twoFactor ? "SEED" : null,
      })
      .returning({ id: users.id });
    userIds.push(row!.id);
    return { id: row!.id, email };
  }

  /** An AdminService whose allowlist is exactly these emails. */
  function adminServiceFor(...emails: string[]): AdminService {
    return new AdminService(db, envWith(emails.join(",")));
  }

  /** A RequestActor the way AuthGuard would build one from a session JWT. */
  function actorFor(u: { id: string; email: string }): RequestActor {
    return { userId: u.id, workspaceId: randomUUID(), role: "owner", email: u.email, label: u.email };
  }

  beforeAll(async () => {
    handle = createDatabase({ url: DATABASE_URL!, max: 4 });
    db = handle.db;
  });

  afterAll(async () => {
    if (userIds.length) {
      await db.delete(adminAuditLog).where(inArray(adminAuditLog.actorId, userIds));
      await db.delete(users).where(inArray(users.id, userIds));
    }
    await handle.close?.();
  });

  it("refuses a non-admin: a verified, 2FA-on user whose email is NOT in the list", async () => {
    const u = await newUser("nonadmin", { verified: true, twoFactor: true });
    // Allowlist contains a DIFFERENT email.
    const guard = new AdminGuard(adminServiceFor(`someone-else-${stamp}@${ADMIN_EMAIL_DOMAIN}`), envWith(""));
    await expect(guard.canActivate(ctxFor(actorFor(u)))).rejects.toBeInstanceOf(ForbiddenException);
  });

  it("refuses an allow-listed, verified user with 2FA OFF", async () => {
    const u = await newUser("no2fa", { verified: true, twoFactor: false });
    const guard = new AdminGuard(adminServiceFor(u.email), envWith(""));
    await expect(guard.canActivate(ctxFor(actorFor(u)))).rejects.toBeInstanceOf(ForbiddenException);
  });

  it("refuses an allow-listed, 2FA-on user whose email is UNVERIFIED", async () => {
    const u = await newUser("unverified", { verified: false, twoFactor: true });
    const guard = new AdminGuard(adminServiceFor(u.email), envWith(""));
    await expect(guard.canActivate(ctxFor(actorFor(u)))).rejects.toBeInstanceOf(ForbiddenException);
  });

  it("admits a real admin and GET /admin/me returns their identity", async () => {
    const u = await newUser("real", { verified: true, twoFactor: true });
    // Allowlist uses a DIFFERENT CASE to prove the match is case-insensitive.
    const guard = new AdminGuard(adminServiceFor(u.email.toUpperCase()), envWith(""));
    const ctx = ctxFor(actorFor(u));
    await expect(guard.canActivate(ctx)).resolves.toBe(true);

    const request = ctx.switchToHttp().getRequest() as unknown as {
      admin?: { id: string; name: string; email: string };
      adminRequestIp?: string;
    };
    expect(request.admin?.id).toBe(u.id);
    expect(request.admin?.email).toBe(u.email);
    // The guard resolved and attached the client IP for the audit trail.
    expect(request.adminRequestIp).toBe("203.0.113.7");
  });

  it("an API-key caller (no user) is never an admin", async () => {
    const admins = adminServiceFor(`anything-${stamp}@${ADMIN_EMAIL_DOMAIN}`);
    expect(await admins.isAdmin(null)).toBe(false);
  });

  it("an empty allowlist means nobody is an admin, even a verified 2FA user", async () => {
    const u = await newUser("emptylist", { verified: true, twoFactor: true });
    const admins = adminServiceFor(); // empty
    expect(await admins.isAdmin(u.id)).toBe(false);
  });

  it("an admin write through writeAdminAuditEntry lands exactly one append-only row", async () => {
    const u = await newUser("writer");
    await writeAdminAuditEntry(db, {
      actorId: u.id,
      actorLabel: u.email,
      action: "admin.test.write",
      targetType: "user",
      targetId: u.id,
      before: { flag: false },
      after: { flag: true },
      requestIp: "203.0.113.7",
    });

    const rows = await db.select().from(adminAuditLog).where(eq(adminAuditLog.actorId, u.id));
    expect(rows).toHaveLength(1);
    const row = rows[0]!;
    expect(row.action).toBe("admin.test.write");
    expect(row.targetType).toBe("user");
    expect(row.targetId).toBe(u.id);
    expect(row.before).toEqual({ flag: false });
    expect(row.after).toEqual({ flag: true });
    expect(row.requestIp).toBe("203.0.113.7");
    expect(row.at).toBeInstanceOf(Date);
  });
});
