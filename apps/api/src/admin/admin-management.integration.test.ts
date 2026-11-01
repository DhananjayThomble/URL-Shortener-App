import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { JwtService } from "@nestjs/jwt";
import {
  adminAuditLog,
  and,
  clickDaily,
  createDatabase,
  desc,
  domains,
  eq,
  inArray,
  links,
  memberships,
  users,
  workspaces,
  type Database,
} from "@snapurl/database";
import { TokenService } from "../auth/token.service.js";
import type { MailService } from "../mail/mail.service.js";
import type { LinkCacheBustService } from "../common/link-cache-bust.service.js";
import type { ProjectionNudgeService } from "../links/projection-nudge.service.js";
import { WorkspaceRemovalService } from "../workspaces/workspace-removal.service.js";
import type { Env } from "../config/env.js";
import { AdminManagementService, type AdminActor } from "./admin-management.service.js";

/* ============================================================
   #969 — every admin action on a user or workspace records an audit row, and
   "view as" is read-only.

   Oracles are the issue's acceptance lines, not the implementation:
     - "Every action above is admin-only and writes an audit row" — each write
       lands exactly one admin_audit_log row with the right action/target;
     - "View as cannot perform any write" — the view-as read records an audit
       row AND leaves the workspace and its links byte-for-byte unchanged (it is
       a GET with no write path);
     - delete-account removes a sole-owned workspace through the sanctioned
       removal service (cache-busting), proven by the links going AND a
       projection delete being enqueued via that service.

   Red-on-broken: drop the writeAdminAuditEntry call from any action and its
   case fails (zero rows). Point view-as at a mutating path and the unchanged
   assertions fail.

   DB-gated: skips with no DATABASE_URL.
   ============================================================ */

const DATABASE_URL = process.env.DATABASE_URL;
const describeDb = DATABASE_URL ? describe : describe.skip;

class FakeMail {
  sends: Array<{ to: string }> = [];
  async sendEmailVerification(opts: { to: string; token: string }) {
    this.sends.push({ to: opts.to });
  }
  async sendInvite() {}
  async sendPasswordReset() {}
}

const env = {
  JWT_ACCESS_SECRET: "test-access-secret-for-admin-management",
  JWT_ACCESS_TTL: "15m",
  JWT_REFRESH_TTL_DAYS: 30,
  DEFAULT_DOMAIN: "localhost:3002",
} as unknown as Env;

describeDb("#969 — admin actions audit and view-as is read-only", () => {
  let handle: ReturnType<typeof createDatabase>;
  let db: Database;
  let mail: FakeMail;
  let service: AdminManagementService;
  let removal: WorkspaceRemovalService;

  const stamp = `${Date.now().toString(36)}${Math.random().toString(16).slice(2, 6)}`;
  const userIds: string[] = [];
  const workspaceIds: string[] = [];

  // The admin actor is a real user row: admin_audit_log.actor_id FKs users.id.
  let actorId: string;
  let actor: AdminActor;

  /** A user with their own workspace (they are the sole owner), optionally a
   *  verified email, and optionally a few links + a month's clicks. */
  async function seedUserWithWorkspace(tag: string, opts: { verified?: boolean; links?: number } = {}) {
    const email = `am-${tag}-${stamp}@example.com`;
    const [u] = await db
      .insert(users)
      .values({ name: `AM ${tag}`, email, emailVerifiedAt: opts.verified ? new Date() : null })
      .returning({ id: users.id });
    userIds.push(u!.id);

    const [ws] = await db
      .insert(workspaces)
      .values({ name: `WS ${tag}`, slug: `am-${tag}-${stamp}` })
      .returning({ id: workspaces.id });
    workspaceIds.push(ws!.id);

    await db.insert(memberships).values({
      workspaceId: ws!.id,
      userId: u!.id,
      email,
      role: "owner",
      status: "active",
    });

    const host = `am-${tag}-${stamp}.test`;
    const [dom] = await db
      .insert(domains)
      .values({ workspaceId: ws!.id, domain: host, status: "live", ssl: "active" })
      .returning({ id: domains.id });

    const linkIds: string[] = [];
    const n = opts.links ?? 0;
    if (n > 0) {
      for (let i = 0; i < n; i++) linkIds.push(randomUUID());
      await db.insert(links).values(
        linkIds.map((id, i) => ({
          id,
          workspaceId: ws!.id,
          domainId: dom!.id,
          slug: `am-${tag}-${i}-${stamp}`,
          destination: "https://example.org/x",
        })),
      );
      // One click_daily row this month so usage reads non-zero.
      const today = new Date();
      const day = `${today.getUTCFullYear()}-${String(today.getUTCMonth() + 1).padStart(2, "0")}-${String(today.getUTCDate()).padStart(2, "0")}`;
      await db.insert(clickDaily).values({ linkId: linkIds[0]!, workspaceId: ws!.id, day, clicks: 7 });
    }

    return { userId: u!.id, email, workspaceId: ws!.id, host, linkIds };
  }

  async function auditRowsFor(targetId: string) {
    return db.select().from(adminAuditLog).where(eq(adminAuditLog.targetId, targetId)).orderBy(desc(adminAuditLog.at));
  }

  beforeAll(async () => {
    handle = createDatabase({ url: DATABASE_URL!, max: 4 });
    db = handle.db;
    const tokens = new TokenService(db, env, new JwtService());
    mail = new FakeMail();
    const cacheBust = { bust: async () => {} } as unknown as LinkCacheBustService;
    const nudge = { nudge: () => {} } as unknown as ProjectionNudgeService;
    removal = new WorkspaceRemovalService(db, cacheBust, nudge);
    service = new AdminManagementService(db, tokens, mail as unknown as MailService, removal);

    const [adminRow] = await db
      .insert(users)
      .values({ name: "Platform Admin", email: `admin-${stamp}@snapurl.test`, emailVerifiedAt: new Date() })
      .returning({ id: users.id, email: users.email });
    userIds.push(adminRow!.id);
    actorId = adminRow!.id;
    actor = { admin: { id: actorId, name: "Platform Admin", email: adminRow!.email }, ip: "203.0.113.11" };
  });

  afterAll(async () => {
    await db.delete(adminAuditLog).where(eq(adminAuditLog.actorId, actorId));
    if (workspaceIds.length) await db.delete(workspaces).where(inArray(workspaces.id, workspaceIds));
    if (userIds.length) await db.delete(users).where(inArray(users.id, userIds));
    await handle.close?.();
  });

  it("suspend writes one audit row with before/after and sets suspended_at", async () => {
    const s = await seedUserWithWorkspace("suspend");
    await service.suspendUser(s.userId, actor);

    const [row] = await auditRowsFor(s.userId);
    expect(row?.action).toBe("admin.user.suspend");
    expect(row?.targetType).toBe("user");
    expect(row?.actorId).toBe(actorId);
    expect(row?.requestIp).toBe("203.0.113.11");
    expect((row?.after as { suspendedAt: string | null }).suspendedAt).toBeTruthy();

    const [u] = await db.select({ suspendedAt: users.suspendedAt }).from(users).where(eq(users.id, s.userId));
    expect(u?.suspendedAt).not.toBeNull();
  });

  it("unsuspend writes an audit row and clears suspended_at", async () => {
    const s = await seedUserWithWorkspace("unsuspend");
    await service.suspendUser(s.userId, actor);
    await service.unsuspendUser(s.userId, actor);

    const rows = await auditRowsFor(s.userId);
    expect(rows.map((r) => r.action)).toContain("admin.user.unsuspend");

    const [u] = await db.select({ suspendedAt: users.suspendedAt }).from(users).where(eq(users.id, s.userId));
    expect(u?.suspendedAt).toBeNull();
  });

  it("sign-out-everywhere writes an audit row", async () => {
    const s = await seedUserWithWorkspace("signout");
    await service.signOutEverywhere(s.userId, actor);
    const rows = await auditRowsFor(s.userId);
    expect(rows.map((r) => r.action)).toContain("admin.user.signout_everywhere");
  });

  it("resend-verification sends mail for an unverified user and writes an audit row", async () => {
    const s = await seedUserWithWorkspace("resend", { verified: false });
    const before = mail.sends.length;
    await service.resendVerification(s.userId, actor);
    expect(mail.sends.length).toBe(before + 1);
    const rows = await auditRowsFor(s.userId);
    expect(rows.map((r) => r.action)).toContain("admin.user.resend_verification");
  });

  it("manual plan/limit edit writes an audit row and applies the change", async () => {
    const s = await seedUserWithWorkspace("plan");
    await service.updateWorkspace(s.workspaceId, { plan: "Pro", clicksIncluded: 5_000_000 }, actor);

    const rows = await auditRowsFor(s.workspaceId);
    expect(rows.map((r) => r.action)).toContain("admin.workspace.update_plan");

    const [ws] = await db
      .select({ plan: workspaces.plan, clicksIncluded: workspaces.clicksIncluded })
      .from(workspaces)
      .where(eq(workspaces.id, s.workspaceId));
    expect(ws?.plan).toBe("Pro");
    expect(ws?.clicksIncluded).toBe(5_000_000);
  });

  it("view-as records the access AND changes nothing in the workspace or its links", async () => {
    const s = await seedUserWithWorkspace("viewas", { links: 2 });

    const wsBefore = await db.select().from(workspaces).where(eq(workspaces.id, s.workspaceId));
    const linksBefore = await db.select().from(links).where(eq(links.workspaceId, s.workspaceId)).orderBy(links.id);
    const auditBefore = await auditRowsFor(s.workspaceId);

    const view = await service.viewAsWorkspace(s.workspaceId, actor);
    // The payload is marked read-only and carries the owner's view.
    expect(view.readOnly).toBe(true);
    expect(view.workspace.id).toBe(s.workspaceId);
    expect(view.recentLinks.length).toBe(2);

    // Exactly one new audit row, the view-as one.
    const auditAfter = await auditRowsFor(s.workspaceId);
    expect(auditAfter.length).toBe(auditBefore.length + 1);
    expect(auditAfter[0]?.action).toBe("admin.workspace.view_as");

    // Nothing in the workspace or its links changed — read-only by construction.
    const wsAfter = await db.select().from(workspaces).where(eq(workspaces.id, s.workspaceId));
    const linksAfter = await db.select().from(links).where(eq(links.workspaceId, s.workspaceId)).orderBy(links.id);
    expect(wsAfter).toEqual(wsBefore);
    expect(linksAfter).toEqual(linksBefore);
  });

  it("delete-account removes the user and their sole-owned workspace, and writes an audit row", async () => {
    const s = await seedUserWithWorkspace("delete", { links: 2 });
    await service.deleteAccount(s.userId, actor);

    // The user is gone.
    expect(await db.select().from(users).where(eq(users.id, s.userId))).toHaveLength(0);
    // The sole-owned workspace is gone (removed via the removal service).
    expect(await db.select().from(workspaces).where(eq(workspaces.id, s.workspaceId))).toHaveLength(0);
    expect(await db.select().from(links).where(eq(links.workspaceId, s.workspaceId))).toHaveLength(0);

    // The audit row survives the deletion (target is the deleted user).
    const rows = await db
      .select()
      .from(adminAuditLog)
      .where(and(eq(adminAuditLog.action, "admin.user.delete"), eq(adminAuditLog.targetId, s.userId)));
    expect(rows).toHaveLength(1);
  });
});
