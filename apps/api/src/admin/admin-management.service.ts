import { Inject, Injectable, NotFoundException } from "@nestjs/common";
import type {
  AdminUserList,
  AdminUserRow,
  AdminUserDetail,
  AdminWorkspaceList,
  AdminWorkspaceRow,
  AdminWorkspaceDetail,
  AdminViewAsWorkspace,
  AdminListQuery,
  AdminUpdateWorkspaceInput,
} from "@snapurl/contract";
import {
  and,
  asc,
  clickDaily,
  desc,
  domains,
  eq,
  gt,
  gte,
  ilike,
  isNull,
  links,
  memberships,
  or,
  refreshTokens,
  sql,
  users,
  workspaces,
  writeAdminAuditEntry,
  type Database,
  type Executor,
} from "@snapurl/database";
import { DB } from "../database/database.module.js";
import { MailService } from "../mail/mail.service.js";
import { TokenService } from "../auth/token.service.js";
import { WorkspaceRemovalService } from "../workspaces/workspace-removal.service.js";
import type { AdminIdentity } from "./admin.service.js";

/** Who performed the action and the request's client IP, carried into every
 *  audit row. Resolved by AdminGuard and handed in by the controller so the
 *  service never re-derives it. */
export interface AdminActor {
  admin: AdminIdentity;
  ip: string | null;
}

/** The first of the calendar month, as a `YYYY-MM-DD` string, for the
 *  click_daily usage read. Kept here (not a shared util) because it is the one
 *  place the admin service needs it. */
function startOfMonthDay(now = new Date()): string {
  return `${now.getUTCFullYear()}-${String(now.getUTCMonth() + 1).padStart(2, "0")}-01`;
}

/**
 * #969 — the users-and-workspaces admin operations.
 *
 * Kept separate from AdminService (the #968 role resolver) so the foundation's
 * security check stays small and this epic part adds its tools beside it rather
 * than inside it. Every WRITE here goes through writeAdminAuditEntry, recording
 * a before/after row in the platform audit log; the reads do too for "view as",
 * because the epic requires each view be recorded.
 */
@Injectable()
export class AdminManagementService {
  constructor(
    @Inject(DB) private readonly db: Database,
    private readonly tokens: TokenService,
    private readonly mail: MailService,
    private readonly workspaceRemoval: WorkspaceRemovalService,
  ) {}

  /* ========================================================
     Users — list, detail, and the account actions.
     ======================================================== */

  /** List users platform-wide, newest first, cursor-paginated by id (UUIDv7, so
   *  id order is creation order). `search` matches email or name. */
  async listUsers(query: AdminListQuery): Promise<AdminUserList> {
    const term = query.search?.trim();
    const filters = [
      term ? or(ilike(users.email, `%${term}%`), ilike(users.name, `%${term}%`)) : undefined,
      // Cursor: ids are UUIDv7 (time-ordered) and we page newest-first, so the
      // next page is rows with an id strictly LESS than the cursor.
      query.cursor ? sql`${users.id} < ${query.cursor}` : undefined,
    ].filter(Boolean);
    const where = filters.length ? and(...filters) : undefined;

    const [{ total }] = await this.db
      .select({ total: sql<number>`count(*)::int` })
      .from(users)
      .where(term ? or(ilike(users.email, `%${term}%`), ilike(users.name, `%${term}%`)) : undefined);

    const rows = await this.db
      .select({
        id: users.id,
        name: users.name,
        email: users.email,
        emailVerifiedAt: users.emailVerifiedAt,
        totpEnabledAt: users.totpEnabledAt,
        suspendedAt: users.suspendedAt,
        createdAt: users.createdAt,
        lastActiveAt: users.lastActiveAt,
        workspaceCount: sql<number>`(
          select count(*)::int from ${memberships} m
          where m.user_id = ${users.id} and m.status = 'active'
        )`,
      })
      .from(users)
      .where(where)
      .orderBy(desc(users.id))
      .limit(query.limit + 1);

    const hasMore = rows.length > query.limit;
    const page = hasMore ? rows.slice(0, query.limit) : rows;
    return {
      items: page.map((r) => this.toUserRow(r)),
      total: total ?? 0,
      nextCursor: hasMore ? page[page.length - 1]!.id : null,
    };
  }

  /** One user with the workspaces they belong to. 404 if there is no such user. */
  async getUser(userId: string): Promise<AdminUserDetail> {
    const row = await this.loadUserRow(userId);
    if (!row) throw new NotFoundException("No such user.");

    const ws = await this.db
      .select({
        id: workspaces.id,
        name: workspaces.name,
        slug: workspaces.slug,
        plan: workspaces.plan,
        role: memberships.role,
      })
      .from(memberships)
      .innerJoin(workspaces, eq(memberships.workspaceId, workspaces.id))
      .where(and(eq(memberships.userId, userId), eq(memberships.status, "active")))
      .orderBy(asc(workspaces.name));

    return {
      ...this.toUserRow(row),
      workspaces: ws.map((w) => ({ id: w.id, name: w.name, slug: w.slug, role: w.role, plan: w.plan })),
    };
  }

  /** Suspend an account: stamp suspendedAt and revoke every refresh-token
   *  family so existing sessions cannot be renewed. A re-suspend of an
   *  already-suspended account is a no-op that still records (idempotent). */
  async suspendUser(userId: string, actor: AdminActor): Promise<void> {
    const before = await this.requireUser(userId);
    const now = new Date();
    await this.db.transaction(async (tx) => {
      await tx.update(users).set({ suspendedAt: now, updatedAt: now }).where(eq(users.id, userId));
      // Within the same transaction so the record and the revocation commit
      // together; the auth paths also refuse a suspended user, so this closes
      // the window on tokens that already exist.
      await this.revokeAllForUserTx(tx, userId);
      await writeAdminAuditEntry(tx, {
        actorId: actor.admin.id,
        actorLabel: actor.admin.email,
        action: "admin.user.suspend",
        targetType: "user",
        targetId: userId,
        before: { suspendedAt: before.suspendedAt?.toISOString() ?? null },
        after: { suspendedAt: now.toISOString() },
        requestIp: actor.ip,
      });
    });
  }

  /** Lift a suspension: clear suspendedAt. The user can sign in again; their
   *  old sessions stay revoked and they sign in fresh. */
  async unsuspendUser(userId: string, actor: AdminActor): Promise<void> {
    const before = await this.requireUser(userId);
    const now = new Date();
    await this.db.transaction(async (tx) => {
      await tx.update(users).set({ suspendedAt: null, updatedAt: now }).where(eq(users.id, userId));
      await writeAdminAuditEntry(tx, {
        actorId: actor.admin.id,
        actorLabel: actor.admin.email,
        action: "admin.user.unsuspend",
        targetType: "user",
        targetId: userId,
        before: { suspendedAt: before.suspendedAt?.toISOString() ?? null },
        after: { suspendedAt: null },
        requestIp: actor.ip,
      });
    });
  }

  /** Sign the user out of every device by revoking all refresh-token families.
   *  Unlike suspend, the account stays active — the user can sign back in. */
  async signOutEverywhere(userId: string, actor: AdminActor): Promise<void> {
    await this.requireUser(userId);
    await this.db.transaction(async (tx) => {
      await this.revokeAllForUserTx(tx, userId);
      await writeAdminAuditEntry(tx, {
        actorId: actor.admin.id,
        actorLabel: actor.admin.email,
        action: "admin.user.signout_everywhere",
        targetType: "user",
        targetId: userId,
        requestIp: actor.ip,
      });
    });
  }

  /** Re-issue the email-verification mail for a user whose email is not yet
   *  verified. A no-op-with-record if already verified (nothing to resend). */
  async resendVerification(userId: string, actor: AdminActor): Promise<void> {
    const user = await this.requireUser(userId);
    const alreadyVerified = user.emailVerifiedAt !== null;
    if (!alreadyVerified) {
      const token = await this.tokens.issueEmailVerificationToken(userId);
      // Best-effort send: a mail hiccup must not fail the admin action or lose
      // the audit record of the attempt.
      try {
        await this.mail.sendEmailVerification({ to: user.email, token });
      } catch {
        // swallowed; the audit row records that a resend was requested.
      }
    }
    await writeAdminAuditEntry(this.db, {
      actorId: actor.admin.id,
      actorLabel: actor.admin.email,
      action: "admin.user.resend_verification",
      targetType: "user",
      targetId: userId,
      after: { alreadyVerified },
      requestIp: actor.ip,
    });
  }

  /**
   * Delete an account on request.
   *
   * Removes the workspaces this user SOLELY owns through
   * WorkspaceRemovalService (so every link's projection is deleted and the
   * redirect cache busted — a bare user delete would cascade the workspace and
   * strand projected links redirecting from the edge). A workspace the user
   * only co-owns, or belongs to without owning, is left alone; only the user's
   * membership in it goes, with the user row.
   *
   * The audit row is written FIRST, in its own statement, so the record
   * survives even though the actor-FK on the user row is unrelated (the admin,
   * not the deleted user). The target is the deleted user.
   */
  async deleteAccount(userId: string, actor: AdminActor): Promise<void> {
    const user = await this.requireUser(userId);
    const soleOwned = await this.workspacesSolelyOwnedBy(userId);

    await writeAdminAuditEntry(this.db, {
      actorId: actor.admin.id,
      actorLabel: actor.admin.email,
      action: "admin.user.delete",
      targetType: "user",
      targetId: userId,
      before: { email: user.email, name: user.name, workspacesRemoved: soleOwned.map((w) => w.id) },
      after: null,
      requestIp: actor.ip,
    });

    // Remove the sole-owned workspaces the sanctioned way (cache-busting).
    for (const w of soleOwned) {
      await this.workspaceRemoval.remove(w.id);
    }
    // Delete the user; memberships, refresh tokens, recovery codes, etc. all
    // cascade from users.id.
    await this.db.delete(users).where(eq(users.id, userId));
  }

  /* ========================================================
     Workspaces — list, detail, the manual plan/limit edit, and view-as.
     ======================================================== */

  async listWorkspaces(query: AdminListQuery): Promise<AdminWorkspaceList> {
    const term = query.search?.trim();
    const match = term ? or(ilike(workspaces.name, `%${term}%`), ilike(workspaces.slug, `%${term}%`)) : undefined;
    const filters = [match, query.cursor ? sql`${workspaces.id} < ${query.cursor}` : undefined].filter(Boolean);
    const where = filters.length ? and(...filters) : undefined;

    const [{ total }] = await this.db
      .select({ total: sql<number>`count(*)::int` })
      .from(workspaces)
      .where(match);

    const rows = await this.db
      .select({
        id: workspaces.id,
        name: workspaces.name,
        slug: workspaces.slug,
        plan: workspaces.plan,
        clicksIncluded: workspaces.clicksIncluded,
        createdAt: workspaces.createdAt,
        memberCount: sql<number>`(
          select count(*)::int from ${memberships} m
          where m.workspace_id = ${workspaces.id} and m.status = 'active'
        )`,
        linkCount: sql<number>`(
          select count(*)::int from ${links} l
          where l.workspace_id = ${workspaces.id} and l.managed_bio_page_id is null
        )`,
        domainCount: sql<number>`(
          select count(*)::int from ${domains} d
          where d.workspace_id = ${workspaces.id}
        )`,
      })
      .from(workspaces)
      .where(where)
      .orderBy(desc(workspaces.id))
      .limit(query.limit + 1);

    const hasMore = rows.length > query.limit;
    const page = hasMore ? rows.slice(0, query.limit) : rows;
    return {
      items: page.map((r) => this.toWorkspaceRow(r)),
      total: total ?? 0,
      nextCursor: hasMore ? page[page.length - 1]!.id : null,
    };
  }

  async getWorkspace(workspaceId: string): Promise<AdminWorkspaceDetail> {
    return this.loadWorkspaceDetail(workspaceId);
  }

  /** The manual plan/limit edit (#969). Enforcement of the limit is #970; this
   *  only records the operator's assignment. */
  async updateWorkspace(
    workspaceId: string,
    input: AdminUpdateWorkspaceInput,
    actor: AdminActor,
  ): Promise<AdminWorkspaceDetail> {
    const [before] = await this.db
      .select({ plan: workspaces.plan, clicksIncluded: workspaces.clicksIncluded })
      .from(workspaces)
      .where(eq(workspaces.id, workspaceId))
      .limit(1);
    if (!before) throw new NotFoundException("No such workspace.");

    const patch: { plan?: string; clicksIncluded?: number; updatedAt: Date } = { updatedAt: new Date() };
    if (input.plan !== undefined) patch.plan = input.plan;
    if (input.clicksIncluded !== undefined) patch.clicksIncluded = input.clicksIncluded;

    await this.db.transaction(async (tx) => {
      await tx.update(workspaces).set(patch).where(eq(workspaces.id, workspaceId));
      await writeAdminAuditEntry(tx, {
        actorId: actor.admin.id,
        actorLabel: actor.admin.email,
        action: "admin.workspace.update_plan",
        targetType: "workspace",
        targetId: workspaceId,
        before: { plan: before.plan, clicksIncluded: before.clicksIncluded },
        after: {
          plan: input.plan ?? before.plan,
          clicksIncluded: input.clicksIncluded ?? before.clicksIncluded,
        },
        requestIp: actor.ip,
      });
    });

    return this.loadWorkspaceDetail(workspaceId);
  }

  /**
   * Read-only "view as": the workspace's data as its owner sees it, recorded in
   * the audit log. There is no write path here at all — it is a GET that
   * assembles a snapshot — so "view as cannot perform any write" holds by
   * construction, not by a permission check that could be bypassed.
   */
  async viewAsWorkspace(workspaceId: string, actor: AdminActor): Promise<AdminViewAsWorkspace> {
    const detail = await this.loadWorkspaceDetail(workspaceId);

    const recent = await this.db
      .select({
        id: links.id,
        slug: links.slug,
        domain: domains.domain,
        destination: links.destination,
        createdAt: links.createdAt,
        clicks: sql<number>`(
          select coalesce(sum(cd.clicks), 0)::int from ${clickDaily} cd where cd.link_id = ${links.id}
        )`,
      })
      .from(links)
      .innerJoin(domains, eq(links.domainId, domains.id))
      .where(and(eq(links.workspaceId, workspaceId), isNull(links.managedBioPageId)))
      .orderBy(desc(links.id))
      .limit(10);

    await writeAdminAuditEntry(this.db, {
      actorId: actor.admin.id,
      actorLabel: actor.admin.email,
      action: "admin.workspace.view_as",
      targetType: "workspace",
      targetId: workspaceId,
      requestIp: actor.ip,
    });

    return {
      workspace: detail,
      recentLinks: recent.map((l) => ({
        id: l.id,
        slug: l.slug,
        domain: l.domain,
        destination: l.destination,
        clicks: l.clicks ?? 0,
        createdAt: l.createdAt.toISOString(),
      })),
      readOnly: true,
    };
  }

  /* ========================================================
     Internals.
     ======================================================== */

  private async loadWorkspaceDetail(workspaceId: string): Promise<AdminWorkspaceDetail> {
    const [ws] = await this.db
      .select({
        id: workspaces.id,
        name: workspaces.name,
        slug: workspaces.slug,
        plan: workspaces.plan,
        clicksIncluded: workspaces.clicksIncluded,
        currency: workspaces.currency,
        retentionYears: workspaces.retentionYears,
        createdAt: workspaces.createdAt,
      })
      .from(workspaces)
      .where(eq(workspaces.id, workspaceId))
      .limit(1);
    if (!ws) throw new NotFoundException("No such workspace.");

    const members = await this.db
      .select({
        userId: memberships.userId,
        email: memberships.email,
        name: users.name,
        role: memberships.role,
        status: memberships.status,
      })
      .from(memberships)
      .leftJoin(users, eq(memberships.userId, users.id))
      .where(eq(memberships.workspaceId, workspaceId))
      .orderBy(asc(memberships.email));

    const [counts] = await this.db
      .select({
        linkCount: sql<number>`(
          select count(*)::int from ${links} l
          where l.workspace_id = ${workspaceId} and l.managed_bio_page_id is null
        )`,
        domainCount: sql<number>`(
          select count(*)::int from ${domains} d where d.workspace_id = ${workspaceId}
        )`,
      })
      .from(workspaces)
      .where(eq(workspaces.id, workspaceId))
      .limit(1);

    const [{ clicksThisMonth }] = await this.db
      .select({ clicksThisMonth: sql<number>`coalesce(sum(${clickDaily.clicks}), 0)::int` })
      .from(clickDaily)
      .where(and(eq(clickDaily.workspaceId, workspaceId), gte(clickDaily.day, startOfMonthDay())));

    return {
      id: ws.id,
      name: ws.name,
      slug: ws.slug,
      plan: ws.plan,
      clicksIncluded: ws.clicksIncluded,
      currency: ws.currency,
      retentionYears: ws.retentionYears,
      memberCount: members.filter((m) => m.status === "active").length,
      linkCount: counts?.linkCount ?? 0,
      domainCount: counts?.domainCount ?? 0,
      createdAt: ws.createdAt.toISOString(),
      members: members.map((m) => ({
        userId: m.userId,
        email: m.email,
        name: m.name,
        role: m.role,
        status: m.status,
      })),
      clicksThisMonth: clicksThisMonth ?? 0,
    };
  }

  private async loadUserRow(userId: string) {
    const [row] = await this.db
      .select({
        id: users.id,
        name: users.name,
        email: users.email,
        emailVerifiedAt: users.emailVerifiedAt,
        totpEnabledAt: users.totpEnabledAt,
        suspendedAt: users.suspendedAt,
        createdAt: users.createdAt,
        lastActiveAt: users.lastActiveAt,
        workspaceCount: sql<number>`(
          select count(*)::int from ${memberships} m
          where m.user_id = ${users.id} and m.status = 'active'
        )`,
      })
      .from(users)
      .where(eq(users.id, userId))
      .limit(1);
    return row ?? null;
  }

  /** Load the raw user row or 404 — used by the write actions that need the
   *  before-state and the email. */
  private async requireUser(userId: string) {
    const [user] = await this.db.select().from(users).where(eq(users.id, userId)).limit(1);
    if (!user) throw new NotFoundException("No such user.");
    return user;
  }

  /** The workspaces this user is the ONLY active owner of. Those are the ones a
   *  delete removes outright; a workspace with another owner survives. */
  private async workspacesSolelyOwnedBy(userId: string): Promise<{ id: string }[]> {
    const owned = await this.db
      .select({ id: memberships.workspaceId })
      .from(memberships)
      .where(and(eq(memberships.userId, userId), eq(memberships.role, "owner"), eq(memberships.status, "active")));

    const result: { id: string }[] = [];
    for (const w of owned) {
      const [{ otherOwners }] = await this.db
        .select({ otherOwners: sql<number>`count(*)::int` })
        .from(memberships)
        .where(
          and(
            eq(memberships.workspaceId, w.id),
            eq(memberships.role, "owner"),
            eq(memberships.status, "active"),
            sql`${memberships.userId} <> ${userId}`,
          ),
        );
      if ((otherOwners ?? 0) === 0) result.push({ id: w.id });
    }
    return result;
  }

  /** Revoke every live refresh-token family for a user, inside the given
   *  transaction handle. Mirrors TokenService.revokeAllForUser but on `tx` so
   *  it commits with the suspend/signout it accompanies. */
  private async revokeAllForUserTx(tx: Executor, userId: string): Promise<void> {
    await tx
      .update(refreshTokens)
      .set({ revokedAt: new Date() })
      .where(and(eq(refreshTokens.userId, userId), isNull(refreshTokens.revokedAt)));
  }

  private toUserRow(r: {
    id: string;
    name: string;
    email: string;
    emailVerifiedAt: Date | null;
    totpEnabledAt: Date | null;
    suspendedAt: Date | null;
    createdAt: Date;
    lastActiveAt: Date | null;
    workspaceCount: number;
  }): AdminUserRow {
    return {
      id: r.id,
      name: r.name,
      email: r.email,
      emailVerified: r.emailVerifiedAt !== null,
      twoFactorEnabled: r.totpEnabledAt !== null,
      suspendedAt: r.suspendedAt?.toISOString() ?? null,
      workspaceCount: r.workspaceCount,
      createdAt: r.createdAt.toISOString(),
      lastActiveAt: r.lastActiveAt?.toISOString() ?? null,
    };
  }

  private toWorkspaceRow(r: {
    id: string;
    name: string;
    slug: string;
    plan: string;
    clicksIncluded: number;
    createdAt: Date;
    memberCount: number;
    linkCount: number;
    domainCount: number;
  }): AdminWorkspaceRow {
    return {
      id: r.id,
      name: r.name,
      slug: r.slug,
      plan: r.plan,
      clicksIncluded: r.clicksIncluded,
      memberCount: r.memberCount,
      linkCount: r.linkCount,
      domainCount: r.domainCount,
      createdAt: r.createdAt.toISOString(),
    };
  }
}
