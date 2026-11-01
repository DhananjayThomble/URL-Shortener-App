import { Body, Controller, Delete, Get, HttpCode, Param, ParseUUIDPipe, Patch, Post, Query, UseGuards } from "@nestjs/common";
import {
  AddBlockedDomainInput,
  AdminAbuseQueueQuery,
  AdminAbuseReportAction,
  AdminAuditQuery,
  AdminLinkDisableInput,
  AdminLinkSearchQuery,
  AdminListQuery,
  AdminUpdateWorkspaceInput,
  PlatformSettingsInput,
  type AdminAbuseQueuePage,
  type AdminActionResult,
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
  type AdminUserDetail,
  type AdminUserList,
  type AdminViewAsWorkspace,
  type AdminWorkspaceDetail,
  type AdminWorkspaceList,
  type PlatformSettings,
} from "@snapurl/contract";
import { zodBody, zodQuery } from "../common/zod.pipe.js";
import { AdminGuard, Admin, AdminRequestIp } from "./admin.guard.js";
import type { AdminIdentity } from "./admin.service.js";
import { AdminHealthService } from "./admin.health.service.js";
import { AdminModerationService } from "./admin.moderation.service.js";
import { AdminManagementService, type AdminActor } from "./admin-management.service.js";
import { PlatformSettingsService } from "./platform-settings.service.js";

/* ============================================================
   #968 + #974 + #969 — the platform-admin API surface (/api/v1/admin/*).

   Every route is behind AdminGuard, so reaching any handler already means the
   caller is a confirmed platform admin (verified allow-listed email + 2FA).
   #968 shipped GET /admin/me; #974 adds system health and operations; #969 adds
   the users-and-workspaces tools. Every write records a row in the platform
   audit log through its service.
   ============================================================ */
@Controller("admin")
@UseGuards(AdminGuard)
export class AdminController {
  constructor(
    private readonly health: AdminHealthService,
    private readonly moderation: AdminModerationService,
    private readonly management: AdminManagementService,
    private readonly settings: PlatformSettingsService,
  ) {}

  /** Who the caller is, confirmed as a platform admin. The client uses a 200
   *  here as "you may enter the admin area"; a non-admin gets a 403 from the
   *  guard and never reaches this. */
  @Get("me")
  me(@Admin() admin: AdminIdentity): AdminMe {
    return { id: admin.id, name: admin.name, email: admin.email, isPlatformAdmin: true };
  }

  /* ── runtime platform settings (#972) ── */

  /** The settings page: the effective values, the defaults, and who last
   *  changed each. */
  @Get("settings")
  getSettings(): Promise<PlatformSettings> {
    return this.settings.getForAdmin();
  }

  /** Change one or more settings. Every changed key writes a before/after audit
   *  row (in the service, in one transaction with the upsert). A change takes
   *  effect within the runtime cache window without a restart — the rate limit
   *  and the signup gate read the same store. */
  @Patch("settings")
  updateSettings(
    @Body(zodBody(PlatformSettingsInput)) input: PlatformSettingsInput,
    @Admin() admin: AdminIdentity,
    @AdminRequestIp() ip: string | null,
  ): Promise<PlatformSettings> {
    return this.settings.update(input, actor(admin, ip));
  }

  /* ── users (#969) ── */

  @Get("users")
  listUsers(@Query(zodQuery(AdminListQuery)) query: AdminListQuery): Promise<AdminUserList> {
    return this.management.listUsers(query);
  }

  @Get("users/:id")
  getUser(@Param("id", ParseUUIDPipe) id: string): Promise<AdminUserDetail> {
    return this.management.getUser(id);
  }

  @Post("users/:id/suspend")
  async suspendUser(
    @Param("id", ParseUUIDPipe) id: string,
    @Admin() admin: AdminIdentity,
    @AdminRequestIp() ip: string | null,
  ): Promise<AdminActionResult> {
    await this.management.suspendUser(id, actor(admin, ip));
    return { id, action: "suspend", ok: true };
  }

  @Post("users/:id/unsuspend")
  async unsuspendUser(
    @Param("id", ParseUUIDPipe) id: string,
    @Admin() admin: AdminIdentity,
    @AdminRequestIp() ip: string | null,
  ): Promise<AdminActionResult> {
    await this.management.unsuspendUser(id, actor(admin, ip));
    return { id, action: "unsuspend", ok: true };
  }

  @Post("users/:id/signout-everywhere")
  async signOutEverywhere(
    @Param("id", ParseUUIDPipe) id: string,
    @Admin() admin: AdminIdentity,
    @AdminRequestIp() ip: string | null,
  ): Promise<AdminActionResult> {
    await this.management.signOutEverywhere(id, actor(admin, ip));
    return { id, action: "signout_everywhere", ok: true };
  }

  @Post("users/:id/resend-verification")
  async resendVerification(
    @Param("id", ParseUUIDPipe) id: string,
    @Admin() admin: AdminIdentity,
    @AdminRequestIp() ip: string | null,
  ): Promise<AdminActionResult> {
    await this.management.resendVerification(id, actor(admin, ip));
    return { id, action: "resend_verification", ok: true };
  }

  @Delete("users/:id")
  @HttpCode(200)
  async deleteUser(
    @Param("id", ParseUUIDPipe) id: string,
    @Admin() admin: AdminIdentity,
    @AdminRequestIp() ip: string | null,
  ): Promise<AdminActionResult> {
    await this.management.deleteAccount(id, actor(admin, ip));
    return { id, action: "delete", ok: true };
  }

  /* ── workspaces (#969) ── */

  @Get("workspaces")
  listWorkspaces(@Query(zodQuery(AdminListQuery)) query: AdminListQuery): Promise<AdminWorkspaceList> {
    return this.management.listWorkspaces(query);
  }

  @Get("workspaces/:id")
  getWorkspace(@Param("id", ParseUUIDPipe) id: string): Promise<AdminWorkspaceDetail> {
    return this.management.getWorkspace(id);
  }

  @Patch("workspaces/:id")
  updateWorkspace(
    @Param("id", ParseUUIDPipe) id: string,
    @Body(zodBody(AdminUpdateWorkspaceInput)) input: AdminUpdateWorkspaceInput,
    @Admin() admin: AdminIdentity,
    @AdminRequestIp() ip: string | null,
  ): Promise<AdminWorkspaceDetail> {
    return this.management.updateWorkspace(id, input, actor(admin, ip));
  }

  /** Read-only "view as": a GET that assembles the owner's view and records the
   *  access. It returns data only — there is no write path to abuse. */
  @Get("workspaces/:id/view-as")
  viewAsWorkspace(
    @Param("id", ParseUUIDPipe) id: string,
    @Admin() admin: AdminIdentity,
    @AdminRequestIp() ip: string | null,
  ): Promise<AdminViewAsWorkspace> {
    return this.management.viewAsWorkspace(id, actor(admin, ip));
  }

  /* ── system health and operations (#974) ── */

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

/** Fold the two guard-supplied params into the service's AdminActor. */
function actor(admin: AdminIdentity, ip: string | null): AdminActor {
  return { admin, ip };
}
