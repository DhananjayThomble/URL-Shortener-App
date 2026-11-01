import { Body, Controller, Delete, Get, HttpCode, Param, ParseUUIDPipe, Patch, Post, Query, UseGuards } from "@nestjs/common";
import {
  AddBlockedDomainInput,
  AdminAbuseQueueQuery,
  AdminAbuseReportAction,
  AdminAuditQuery,
  AdminLinkDisableInput,
  AdminLinkSearchQuery,
  type AdminAbuseQueuePage,
  type AdminAuditPage,
  type AdminBacklogs,
  type AdminBlockedDomain,
  type AdminBlockedDomains,
  type AdminCustomDomains,
  type AdminFlaggedLinks,
  type AdminLinkPage,
  type AdminMe,
  type AdminRetryResult,
  type AdminServiceHealth,
} from "@snapurl/contract";
import { zodBody, zodQuery } from "../common/zod.pipe.js";
import { AdminGuard, Admin, AdminRequestIp } from "./admin.guard.js";
import type { AdminIdentity } from "./admin.service.js";
import { AdminHealthService } from "./admin.health.service.js";
import { AdminModerationService } from "./admin.moderation.service.js";

/* ============================================================
   #968 — the platform-admin API surface (/api/v1/admin/*).

   Every route is behind AdminGuard, so reaching any handler here already means
   the caller is a confirmed platform admin (verified allow-listed email + 2FA).
   This first part ships only GET /admin/me; later parts of the epic (#975) add
   the real admin operations, each of which records through writeAdminAuditEntry.
   ============================================================ */
@Controller("admin")
@UseGuards(AdminGuard)
export class AdminController {
  constructor(
    private readonly health: AdminHealthService,
    private readonly moderation: AdminModerationService,
  ) {}

  /** Who the caller is, confirmed as a platform admin. The client uses a 200
   *  here as "you may enter the admin area"; a non-admin gets a 403 from the
   *  guard and never reaches this. */
  @Get("me")
  me(@Admin() admin: AdminIdentity): AdminMe {
    return { id: admin.id, name: admin.name, email: admin.email, isPlatformAdmin: true };
  }

  /* ---- #974 system health and operations ---- */

  /** The state of the api, database, redirect edge and background worker. */
  @Get("health/services")
  services(): Promise<AdminServiceHealth> {
    return this.health.services();
  }

  /** Real counts for the three operational backlogs. */
  @Get("health/backlogs")
  backlogs(): Promise<AdminBacklogs> {
    return this.health.backlogs();
  }

  /** Re-queue every dead-lettered edge update. Admin-only (guard) and audited. */
  @Post("health/backlogs/projection-outbox/retry")
  @HttpCode(200)
  retryProjectionOutbox(
    @Admin() admin: AdminIdentity,
    @AdminRequestIp() ip: string | null,
  ): Promise<AdminRetryResult> {
    return this.health.retryProjectionOutbox(admin, ip);
  }

  /** Re-queue every failed webhook delivery. Admin-only (guard) and audited. */
  @Post("health/backlogs/webhook-deliveries/retry")
  @HttpCode(200)
  retryWebhookDeliveries(
    @Admin() admin: AdminIdentity,
    @AdminRequestIp() ip: string | null,
  ): Promise<AdminRetryResult> {
    return this.health.retryWebhookDeliveries(admin, ip);
  }

  /** Release a stuck job lease (held past its expiry). Admin-only and audited. */
  @Post("health/backlogs/job-leases/:name/release")
  @HttpCode(200)
  releaseJobLease(
    @Param("name") name: string,
    @Admin() admin: AdminIdentity,
    @AdminRequestIp() ip: string | null,
  ): Promise<AdminRetryResult> {
    return this.health.releaseJobLease(name, admin, ip);
  }

  /** The platform-admin audit trail, with filters. */
  @Get("audit")
  adminAudit(@Query(zodQuery(AdminAuditQuery)) q: AdminAuditQuery): Promise<AdminAuditPage> {
    return this.health.adminAudit(q);
  }

  /** Any single workspace's audit trail, with filters. */
  @Get("workspaces/:workspaceId/audit")
  workspaceAudit(
    @Param("workspaceId", ParseUUIDPipe) workspaceId: string,
    @Query(zodQuery(AdminAuditQuery)) q: AdminAuditQuery,
  ): Promise<AdminAuditPage> {
    return this.health.workspaceAudit(workspaceId, q);
  }

  /* ---- #971 moderation and abuse ---- */

  /** The global abuse queue, including reports with no workspace. */
  @Get("abuse-reports")
  abuseQueue(@Query(zodQuery(AdminAbuseQueueQuery)) q: AdminAbuseQueueQuery): Promise<AdminAbuseQueuePage> {
    return this.moderation.abuseQueue(q);
  }

  /** Act on one abuse report: move its status and/or disable its link. Audited. */
  @Post("abuse-reports/:id/action")
  @HttpCode(204)
  actOnReport(
    @Param("id", ParseUUIDPipe) id: string,
    @Body(zodBody(AdminAbuseReportAction)) input: AdminAbuseReportAction,
    @Admin() admin: AdminIdentity,
    @AdminRequestIp() ip: string | null,
  ): Promise<void> {
    return this.moderation.actOnReport(id, input, admin, ip);
  }

  /** Platform link search — by slug, destination or owner. */
  @Get("links")
  searchLinks(@Query(zodQuery(AdminLinkSearchQuery)) q: AdminLinkSearchQuery): Promise<AdminLinkPage> {
    return this.moderation.searchLinks(q);
  }

  /** Disable or re-enable a link platform-wide (stops/starts edge redirect). Audited. */
  @Post("links/:id/disable")
  @HttpCode(204)
  disableLink(
    @Param("id", ParseUUIDPipe) id: string,
    @Body(zodBody(AdminLinkDisableInput)) input: AdminLinkDisableInput,
    @Admin() admin: AdminIdentity,
    @AdminRequestIp() ip: string | null,
  ): Promise<void> {
    return this.moderation.disableLink(id, input, admin, ip);
  }

  /** The destination blocklist. */
  @Get("blocked-domains")
  blockedDomains(): Promise<AdminBlockedDomains> {
    return this.moderation.listBlockedDomains();
  }

  /** Add a destination host to the blocklist. Audited. */
  @Post("blocked-domains")
  @HttpCode(201)
  addBlockedDomain(
    @Body(zodBody(AddBlockedDomainInput)) input: AddBlockedDomainInput,
    @Admin() admin: AdminIdentity,
    @AdminRequestIp() ip: string | null,
  ): Promise<AdminBlockedDomain> {
    return this.moderation.addBlockedDomain(input, admin, ip);
  }

  /** Remove a destination host from the blocklist. Audited. */
  @Delete("blocked-domains/:id")
  @HttpCode(204)
  removeBlockedDomain(
    @Param("id", ParseUUIDPipe) id: string,
    @Admin() admin: AdminIdentity,
    @AdminRequestIp() ip: string | null,
  ): Promise<void> {
    return this.moderation.removeBlockedDomain(id, admin, ip);
  }

  /** Links Safe Browsing has flagged, platform-wide. */
  @Get("flagged-links")
  flaggedLinks(): Promise<AdminFlaggedLinks> {
    return this.moderation.flaggedLinks();
  }

  /** Every custom domain with its verification and SSL status. */
  @Get("custom-domains")
  customDomains(): Promise<AdminCustomDomains> {
    return this.moderation.customDomains();
  }
}
