import { BadRequestException, ConflictException, Inject, Injectable, NotFoundException } from "@nestjs/common";
import { randomBytes, createHash } from "node:crypto";
import { and, auditLog, desc, eq, links, memberships, sql, users, type Database } from "@snapurl/database";
import type { AuditEntry, InviteMemberInput, Member } from "@snapurl/contract";
import { DB } from "../database/database.module.js";
import { initialsOf } from "../auth/auth.service.js";
import { MailService } from "../mail/mail.service.js";

@Injectable()
export class MembersService {
  constructor(
    @Inject(DB) private readonly db: Database,
    private readonly mail: MailService,
  ) {}

  async list(workspaceId: string): Promise<Member[]> {
    const rows = await this.db
      .select({
        membership: memberships,
        user: users,
        linkCount: sql<number>`(select count(*) from ${links} where ${links.createdBy} = ${memberships.userId})::int`,
      })
      .from(memberships)
      .leftJoin(users, eq(memberships.userId, users.id))
      .where(eq(memberships.workspaceId, workspaceId))
      .orderBy(memberships.createdAt);

    return rows.map(({ membership, user, linkCount }) => ({
      id: membership.id,
      // An invited member has no user row yet, so the email is all we can show.
      name: user?.name ?? membership.email,
      email: membership.email,
      role: membership.role as Member["role"],
      status: membership.status as Member["status"],
      links: linkCount,
      lastActive: user?.lastActiveAt?.toISOString() ?? null,
      /* G6 — this column is why the whole TOTP module exists. It was rendered
         by the team page with nothing behind it. */
      twoFactor: Boolean(user?.totpEnabledAt),
      initials: initialsOf(user?.name ?? membership.email),
    }));
  }

  async invite(workspaceId: string, actorLabel: string, input: InviteMemberInput): Promise<Member> {
    const email = input.email.toLowerCase().trim();

    const [existing] = await this.db
      .select({ id: memberships.id, status: memberships.status })
      .from(memberships)
      .where(and(eq(memberships.workspaceId, workspaceId), sql`lower(${memberships.email}) = ${email}`))
      .limit(1);

    if (existing) {
      throw new ConflictException(
        existing.status === "invited"
          ? `${email} has already been invited. Resend the invitation instead.`
          : `${email} is already on this team.`,
      );
    }

    // The token is emailed; only its hash is stored, so a leaked database
    // cannot be used to accept invitations.
    const token = randomBytes(32).toString("base64url");

    // If they already have an account, attach it now so the invite is one click.
    const [user] = await this.db
      .select({ id: users.id })
      .from(users)
      .where(sql`lower(${users.email}) = ${email}`)
      .limit(1);

    const [row] = await this.db
      .insert(memberships)
      .values({
        workspaceId,
        userId: user?.id ?? null,
        email,
        role: input.role,
        status: "invited",
        inviteTokenHash: createHash("sha256").update(token).digest("hex"),
        invitedAt: new Date(),
      })
      .returning();

    await this.mail.sendInvite({ to: email, token, invitedBy: actorLabel });
    await this.writeAudit(workspaceId, null, actorLabel, "member.invited", "membership", row!.id, { email });

    return {
      id: row!.id,
      name: email,
      email,
      role: input.role,
      status: "invited",
      links: 0,
      lastActive: null,
      twoFactor: false,
      initials: initialsOf(email),
    };
  }

  async changeRole(workspaceId: string, membershipId: string, role: Member["role"], actorLabel: string) {
    const [target] = await this.db
      .select()
      .from(memberships)
      .where(and(eq(memberships.id, membershipId), eq(memberships.workspaceId, workspaceId)))
      .limit(1);
    if (!target) throw new NotFoundException("That person isn't on this team.");

    /* A workspace with no owner cannot be administered by anyone, and there is
       no support desk to undo it. */
    if (target.role === "owner" && role !== "owner") {
      const [{ owners }] = await this.db
        .select({ owners: sql<number>`count(*)::int` })
        .from(memberships)
        .where(and(eq(memberships.workspaceId, workspaceId), eq(memberships.role, "owner")));
      if ((owners ?? 0) <= 1) {
        throw new BadRequestException("This is the only owner. Make someone else an owner first.");
      }
    }

    await this.db.update(memberships).set({ role }).where(eq(memberships.id, membershipId));
    await this.writeAudit(workspaceId, null, actorLabel, "member.role_changed", "membership", membershipId, {
      from: target.role,
      to: role,
    });
  }

  async remove(workspaceId: string, membershipId: string, actorLabel: string): Promise<void> {
    const [target] = await this.db
      .select()
      .from(memberships)
      .where(and(eq(memberships.id, membershipId), eq(memberships.workspaceId, workspaceId)))
      .limit(1);
    if (!target) throw new NotFoundException("That person isn't on this team.");

    if (target.role === "owner") {
      const [{ owners }] = await this.db
        .select({ owners: sql<number>`count(*)::int` })
        .from(memberships)
        .where(and(eq(memberships.workspaceId, workspaceId), eq(memberships.role, "owner")));
      if ((owners ?? 0) <= 1) {
        throw new BadRequestException("This is the only owner. Make someone else an owner before removing them.");
      }
    }

    await this.db.delete(memberships).where(eq(memberships.id, membershipId));
    await this.writeAudit(workspaceId, null, actorLabel, "member.removed", "membership", membershipId, {
      email: target.email,
    });
  }

  async audit(workspaceId: string, limit = 50): Promise<AuditEntry[]> {
    const rows = await this.db
      .select()
      .from(auditLog)
      .where(eq(auditLog.workspaceId, workspaceId))
      .orderBy(desc(auditLog.at))
      .limit(limit);

    return rows.map((row) => ({
      id: row.id,
      at: row.at.toISOString(),
      actor: row.actorLabel,
      action: describe(row.action, row.metadata as Record<string, unknown> | null),
    }));
  }

  async writeAudit(
    workspaceId: string,
    actorId: string | null,
    actorLabel: string,
    action: string,
    targetType?: string,
    targetId?: string,
    metadata?: Record<string, unknown>,
  ) {
    await this.db.insert(auditLog).values({
      workspaceId,
      actorId,
      actorLabel,
      action,
      targetType: targetType ?? null,
      targetId: targetId ?? null,
      metadata: metadata ?? null,
    });
  }
}

/** The audit list is read by people, not machines, so the stored action key is
 *  rendered as a sentence rather than shown raw. */
function describe(action: string, metadata: Record<string, unknown> | null): string {
  const email = typeof metadata?.email === "string" ? metadata.email : null;
  switch (action) {
    case "member.invited":
      return `Invited ${email ?? "a teammate"}`;
    case "member.removed":
      return `Removed ${email ?? "a teammate"}`;
    case "member.role_changed":
      return `Changed a role from ${metadata?.from} to ${metadata?.to}`;
    case "link.created":
      return `Created ${metadata?.slug ?? "a link"}`;
    case "link.updated":
      return `Edited ${metadata?.slug ?? "a link"}`;
    case "link.deleted":
      return `Deleted ${metadata?.slug ?? "a link"}`;
    case "domain.added":
      return `Connected ${metadata?.domain ?? "a domain"}`;
    case "domain.verified":
      return `Verified ${metadata?.domain ?? "a domain"}`;
    case "apikey.created":
      return `Created an API key`;
    case "apikey.revoked":
      return `Revoked an API key`;
    default:
      return action;
  }
}
