import { BadRequestException, ConflictException, Inject, Injectable, NotFoundException } from "@nestjs/common";
import {
  abuseReports,
  and,
  blockedDomains,
  desc,
  domains,
  eq,
  isNotNull,
  links,
  projectionOutbox,
  sql,
  users,
  workspaces,
  writeAdminAuditEntry,
  type Database,
} from "@snapurl/database";
import type {
  AddBlockedDomainInput,
  AdminAbuseQueuePage,
  AdminAbuseQueueQuery,
  AdminAbuseReportAction,
  AdminAbuseReportRow,
  AdminBlockedDomain,
  AdminBlockedDomains,
  AdminCustomDomains,
  AdminFlaggedLinks,
  AdminLinkDisableInput,
  AdminLinkPage,
  AdminLinkRow,
  AdminLinkSearchQuery,
} from "@snapurl/contract";
import { DB, READ_DB } from "../database/database.module.js";
import { ProjectionNudgeService } from "../links/projection-nudge.service.js";
import { LinkCacheBustService } from "../common/link-cache-bust.service.js";
import { escapeLike } from "../common/sql-like.js";
import { normaliseBlockHost } from "../common/blocklist.js";
import type { AdminIdentity } from "./admin.service.js";

/* ============================================================
   #971 — platform moderation and abuse.

   The platform-admin side of abuse handling, across the WHOLE platform. Read
   views (the global abuse queue, platform link search, the Safe Browsing
   flagged list, the custom-domain status list, the blocklist) run on the read
   handle — pure reporting, no write follows. Every WRITE (acting on a report,
   disabling/enabling a link, adding/removing a blocked domain) runs on the
   primary inside a transaction that records its own admin-audit row via
   writeAdminAuditEntry, so the action and its audit trail commit together.

   Disabling a link is the one write that touches product behaviour, and it
   does it exactly the way LinksService and ReportsService already do: it
   enqueues a projectionOutbox 'upsert' in the SAME transaction as the
   disabled_at change and nudges the worker, then busts the redirect's hot
   cache after commit — so a disabled link stops redirecting at the edge within
   the normal projection window rather than waiting out the scheduled drain.
   ============================================================ */

type AbuseStatus = AdminAbuseReportRow["status"];

@Injectable()
export class AdminModerationService {
  constructor(
    @Inject(DB) private readonly db: Database,
    @Inject(READ_DB) private readonly readDb: Database,
    private readonly projectionNudge: ProjectionNudgeService,
    private readonly cacheBust: LinkCacheBustService,
  ) {}

  /* ---- global abuse queue ------------------------------------------------ */

  /**
   * Every abuse report on the platform, newest first — INCLUDING reports whose
   * slug resolved to no workspace. The workspace-scoped queue in
   * ReportsService.list intentionally hides those (a null workspaceId belongs
   * to no operator); this is the one place they are actionable, which is point
   * 1 of the issue. Each row carries the resolved link's destination and
   * disabled state and the owning workspace's name, left-joined so an
   * unresolved report still comes back with nulls rather than being dropped.
   */
  async abuseQueue(q: AdminAbuseQueueQuery): Promise<AdminAbuseQueuePage> {
    const conditions = [];
    if (q.status) conditions.push(eq(abuseReports.status, q.status));
    // `orphaned` restricts to reports that belong to no workspace — the ones
    // only this queue can surface.
    if (q.orphaned === true) conditions.push(sql`${abuseReports.workspaceId} is null`);
    if (q.orphaned === false) conditions.push(isNotNull(abuseReports.workspaceId));

    const rows = await this.readDb
      .select({
        id: abuseReports.id,
        slug: abuseReports.slug,
        reason: abuseReports.reason,
        reporterContact: abuseReports.reporterContact,
        status: abuseReports.status,
        linkId: abuseReports.linkId,
        destination: links.destination,
        disabledAt: links.disabledAt,
        workspaceId: abuseReports.workspaceId,
        workspaceName: workspaces.name,
        createdAt: abuseReports.createdAt,
        updatedAt: abuseReports.updatedAt,
      })
      .from(abuseReports)
      .leftJoin(links, eq(abuseReports.linkId, links.id))
      .leftJoin(workspaces, eq(abuseReports.workspaceId, workspaces.id))
      .where(conditions.length ? and(...conditions) : undefined)
      .orderBy(desc(abuseReports.createdAt))
      .limit(q.limit + 1)
      .offset(q.offset);

    const hasMore = rows.length > q.limit;
    const page = hasMore ? rows.slice(0, q.limit) : rows;
    return {
      hasMore,
      rows: page.map((r) => ({
        id: r.id,
        slug: r.slug,
        reason: r.reason,
        reporterContact: r.reporterContact,
        status: r.status as AbuseStatus,
        linkId: r.linkId,
        destination: r.destination ?? null,
        workspaceId: r.workspaceId,
        workspaceName: r.workspaceName ?? null,
        linkDisabled: r.disabledAt != null,
        createdAt: r.createdAt.toISOString(),
        updatedAt: r.updatedAt.toISOString(),
      })),
    };
  }

  /**
   * Act on one abuse report: move its status and/or disable the link behind
   * it, in a single audited transaction. A request with neither a status nor
   * disableLink is a no-op and refused. Disabling here goes through the same
   * projection path as disableLink() so it stops redirecting at the edge.
   */
  async actOnReport(id: string, input: AdminAbuseReportAction, admin: AdminIdentity, requestIp: string | null): Promise<void> {
    if (input.status === undefined && input.disableLink === undefined) {
      throw new BadRequestException("Nothing to do: pass a status, disableLink, or both.");
    }

    const [report] = await this.db.select().from(abuseReports).where(eq(abuseReports.id, id)).limit(1);
    if (!report) throw new NotFoundException("That report doesn't exist.");

    // Resolve the link's (host, slug) up front for the post-commit cache bust —
    // only when we will actually disable it and it resolved to a link.
    const disabling = input.disableLink === true && report.linkId !== null;

    const busted = await this.db.transaction(async (tx) => {
      let bustKey: { host: string; slug: string } | undefined;

      if (disabling) {
        const updated = await tx
          .update(links)
          .set({ disabledAt: new Date(), updatedAt: new Date() })
          .where(and(eq(links.id, report.linkId!), sql`${links.disabledAt} is null`))
          .returning({ id: links.id, slug: links.slug, domainId: links.domainId });
        // Only project + audit the disable when a row actually changed (the
        // link still exists and was not already disabled).
        if (updated.length > 0) {
          const row = updated[0]!;
          await tx.insert(projectionOutbox).values({
            linkId: row.id,
            operation: "upsert",
            payload: { linkId: row.id, operation: "upsert" },
          });
          this.projectionNudge.nudge();
          const [domainRow] = await tx
            .select({ domain: domains.domain })
            .from(domains)
            .where(eq(domains.id, row.domainId))
            .limit(1);
          if (domainRow) bustKey = { host: domainRow.domain, slug: row.slug };
          await writeAdminAuditEntry(tx, {
            actorId: admin.id,
            actorLabel: admin.email,
            action: "admin.link.disable",
            targetType: "link",
            targetId: row.id,
            before: { disabled: false },
            after: { disabled: true, viaReport: id },
            requestIp,
          });
        }
      }

      const nextStatus = input.status ?? (disabling ? "actioned" : undefined);
      if (nextStatus !== undefined) {
        await tx
          .update(abuseReports)
          .set({ status: nextStatus, updatedAt: new Date() })
          .where(eq(abuseReports.id, id));
        await writeAdminAuditEntry(tx, {
          actorId: admin.id,
          actorLabel: admin.email,
          action: "admin.abuse_report.review",
          targetType: "abuse_report",
          targetId: id,
          before: { status: report.status },
          after: { status: nextStatus },
          requestIp,
        });
      }

      return bustKey;
    });

    if (busted) await this.cacheBust.bust(busted.host, busted.slug);
  }

  /* ---- platform link search + disable/enable ----------------------------- */

  /** Find any link on the platform by slug, destination or owner. With no `q`
   *  it lists the most recent links; `disabled` narrows to on/off. */
  async searchLinks(q: AdminLinkSearchQuery): Promise<AdminLinkPage> {
    const conditions = [];
    if (q.q) {
      const needle = `%${escapeLike(q.q)}%`;
      conditions.push(
        sql`(${links.slug} ilike ${needle} escape '\\'
          or ${links.destination} ilike ${needle} escape '\\'
          or ${users.email} ilike ${needle} escape '\\'
          or ${users.name} ilike ${needle} escape '\\')`,
      );
    }
    if (q.disabled === true) conditions.push(isNotNull(links.disabledAt));
    if (q.disabled === false) conditions.push(sql`${links.disabledAt} is null`);

    const rows = await this.readDb
      .select({
        id: links.id,
        slug: links.slug,
        domain: domains.domain,
        destination: links.destination,
        workspaceId: links.workspaceId,
        workspaceName: workspaces.name,
        ownerEmail: users.email,
        ownerName: users.name,
        disabledAt: links.disabledAt,
        safeBrowsingStatus: links.safeBrowsingStatus,
        createdAt: links.createdAt,
      })
      .from(links)
      .innerJoin(domains, eq(links.domainId, domains.id))
      .leftJoin(workspaces, eq(links.workspaceId, workspaces.id))
      .leftJoin(users, eq(links.createdBy, users.id))
      .where(conditions.length ? and(...conditions) : undefined)
      .orderBy(desc(links.createdAt), desc(links.id))
      .limit(q.limit + 1)
      .offset(q.offset);

    const hasMore = rows.length > q.limit;
    const page = hasMore ? rows.slice(0, q.limit) : rows;
    return {
      hasMore,
      rows: page.map((r) => this.toLinkRow(r)),
    };
  }

  private toLinkRow(r: {
    id: string;
    slug: string;
    domain: string;
    destination: string;
    workspaceId: string;
    workspaceName: string | null;
    ownerEmail: string | null;
    ownerName: string | null;
    disabledAt: Date | null;
    safeBrowsingStatus: string;
    createdAt: Date;
  }): AdminLinkRow {
    return {
      id: r.id,
      slug: r.slug,
      domain: r.domain,
      destination: r.destination,
      workspaceId: r.workspaceId,
      workspaceName: r.workspaceName ?? null,
      owner: r.ownerEmail ?? r.ownerName ?? null,
      disabled: r.disabledAt != null,
      safeBrowsingStatus: r.safeBrowsingStatus,
      createdAt: r.createdAt.toISOString(),
    };
  }

  /**
   * Disable or re-enable a link platform-wide (issue point 3). Disabling sets
   * disabled_at and projects the change to the edge in the same transaction so
   * the link stops redirecting within the projection window; enabling clears
   * it the same way. Idempotent: disabling an already-disabled link (or
   * enabling an enabled one) is accepted and still re-projects, so a stuck edge
   * copy can be forced back into step. Audited either way.
   */
  async disableLink(
    id: string,
    input: AdminLinkDisableInput,
    admin: AdminIdentity,
    requestIp: string | null,
  ): Promise<void> {
    const [link] = await this.db
      .select({ id: links.id, slug: links.slug, domainId: links.domainId, disabledAt: links.disabledAt })
      .from(links)
      .where(eq(links.id, id))
      .limit(1);
    if (!link) throw new NotFoundException("That link doesn't exist.");

    const [{ domain }] = await this.db
      .select({ domain: domains.domain })
      .from(domains)
      .where(eq(domains.id, link.domainId))
      .limit(1);

    await this.db.transaction(async (tx) => {
      await tx
        .update(links)
        .set({ disabledAt: input.disabled ? new Date() : null, updatedAt: new Date() })
        .where(eq(links.id, id));
      // #346-style: propagate to the read projection in the SAME transaction so
      // the redirect's DynamoDB copy flips in step with Postgres.
      await tx.insert(projectionOutbox).values({
        linkId: id,
        operation: "upsert",
        payload: { linkId: id, operation: "upsert" },
      });
      this.projectionNudge.nudge();
      await writeAdminAuditEntry(tx, {
        actorId: admin.id,
        actorLabel: admin.email,
        action: input.disabled ? "admin.link.disable" : "admin.link.enable",
        targetType: "link",
        targetId: id,
        before: { disabled: link.disabledAt != null },
        after: { disabled: input.disabled, reason: input.reason ?? null },
        requestIp,
      });
    });

    // Drop the redirect's hot-cache entry now the change has committed, so a
    // disabled link stops being served from the cache immediately rather than
    // riding out LINK_CACHE_TTL_SECONDS on the stale "clean" copy.
    if (domain) await this.cacheBust.bust(domain, link.slug);
  }

  /* ---- destination blocklist --------------------------------------------- */

  /** The whole destination blocklist, newest first. */
  async listBlockedDomains(): Promise<AdminBlockedDomains> {
    const rows = await this.readDb
      .select({
        id: blockedDomains.id,
        domain: blockedDomains.domain,
        reason: blockedDomains.reason,
        addedByLabel: blockedDomains.addedByLabel,
        createdAt: blockedDomains.createdAt,
      })
      .from(blockedDomains)
      .orderBy(desc(blockedDomains.createdAt));
    return {
      domains: rows.map((r) => ({
        id: r.id,
        domain: r.domain,
        reason: r.reason,
        addedBy: r.addedByLabel,
        createdAt: r.createdAt.toISOString(),
      })),
    };
  }

  /** Add a host to the destination blocklist (issue point 4). The host is
   *  normalised (lower-cased, trimmed) so the enforcement match is consistent.
   *  A host already blocked is a conflict, not a duplicate. Audited. */
  async addBlockedDomain(input: AddBlockedDomainInput, admin: AdminIdentity, requestIp: string | null): Promise<AdminBlockedDomain> {
    const host = normaliseBlockHost(input.domain);
    if (!host) throw new BadRequestException("Enter a domain to block.");

    return this.db.transaction(async (tx) => {
      const [existing] = await tx
        .select({ id: blockedDomains.id })
        .from(blockedDomains)
        .where(sql`lower(${blockedDomains.domain}) = ${host}`)
        .limit(1);
      if (existing) throw new ConflictException(`${host} is already blocked.`);

      const [row] = await tx
        .insert(blockedDomains)
        .values({ domain: host, reason: input.reason ?? null, addedBy: admin.id, addedByLabel: admin.email })
        .returning();
      await writeAdminAuditEntry(tx, {
        actorId: admin.id,
        actorLabel: admin.email,
        action: "admin.blocked_domain.add",
        targetType: "blocked_domain",
        targetId: row!.id,
        before: null,
        after: { domain: host, reason: input.reason ?? null },
        requestIp,
      });
      return {
        id: row!.id,
        domain: row!.domain,
        reason: row!.reason,
        addedBy: row!.addedByLabel,
        createdAt: row!.createdAt.toISOString(),
      };
    });
  }

  /** Remove a host from the blocklist. Audited. 404 if it is not blocked. */
  async removeBlockedDomain(id: string, admin: AdminIdentity, requestIp: string | null): Promise<void> {
    await this.db.transaction(async (tx) => {
      const [row] = await tx
        .delete(blockedDomains)
        .where(eq(blockedDomains.id, id))
        .returning({ id: blockedDomains.id, domain: blockedDomains.domain });
      if (!row) throw new NotFoundException("That blocked domain doesn't exist.");
      await writeAdminAuditEntry(tx, {
        actorId: admin.id,
        actorLabel: admin.email,
        action: "admin.blocked_domain.remove",
        targetType: "blocked_domain",
        targetId: row.id,
        before: { domain: row.domain },
        after: null,
        requestIp,
      });
    });
  }

  /* ---- Safe Browsing flagged list ---------------------------------------- */

  /** Every link Safe Browsing has flagged, platform-wide (issue point 5a). */
  async flaggedLinks(limit = 50, offset = 0): Promise<AdminFlaggedLinks> {
    const rows = await this.readDb
      .select({
        id: links.id,
        slug: links.slug,
        domain: domains.domain,
        destination: links.destination,
        workspaceId: links.workspaceId,
        workspaceName: workspaces.name,
        safeBrowsingStatus: links.safeBrowsingStatus,
        checkedAt: links.safeBrowsingCheckedAt,
        disabledAt: links.disabledAt,
      })
      .from(links)
      .innerJoin(domains, eq(links.domainId, domains.id))
      .leftJoin(workspaces, eq(links.workspaceId, workspaces.id))
      .where(eq(links.safeBrowsingStatus, "flagged"))
      .orderBy(desc(links.safeBrowsingCheckedAt))
      .limit(limit + 1)
      .offset(offset);

    const hasMore = rows.length > limit;
    const page = hasMore ? rows.slice(0, limit) : rows;
    return {
      hasMore,
      rows: page.map((r) => ({
        id: r.id,
        slug: r.slug,
        domain: r.domain,
        destination: r.destination,
        workspaceId: r.workspaceId,
        workspaceName: r.workspaceName ?? null,
        safeBrowsingStatus: r.safeBrowsingStatus,
        checkedAt: r.checkedAt ? r.checkedAt.toISOString() : null,
        disabled: r.disabledAt != null,
      })),
    };
  }

  /* ---- custom-domain status list ----------------------------------------- */

  /** Every custom (non-system) domain with its verification and SSL status
   *  (issue point 5b). System domains (snap.to) are excluded — the list is for
   *  the domains customers connect and whose verification an operator tracks. */
  async customDomains(): Promise<AdminCustomDomains> {
    const rows = await this.readDb
      .select({
        id: domains.id,
        domain: domains.domain,
        workspaceId: domains.workspaceId,
        workspaceName: workspaces.name,
        status: domains.status,
        ssl: domains.ssl,
        verifiedAt: domains.verifiedAt,
        sslRenewsAt: domains.sslRenewsAt,
        createdAt: domains.createdAt,
      })
      .from(domains)
      .leftJoin(workspaces, eq(domains.workspaceId, workspaces.id))
      .where(eq(domains.isSystem, false))
      .orderBy(desc(domains.createdAt));
    return {
      rows: rows.map((r) => ({
        id: r.id,
        domain: r.domain,
        workspaceId: r.workspaceId,
        workspaceName: r.workspaceName ?? null,
        status: r.status,
        ssl: r.ssl,
        verifiedAt: r.verifiedAt ? r.verifiedAt.toISOString() : null,
        sslRenewsAt: r.sslRenewsAt ? r.sslRenewsAt.toISOString() : null,
        createdAt: r.createdAt.toISOString(),
      })),
    };
  }
}
