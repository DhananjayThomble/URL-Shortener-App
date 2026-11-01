import { Controller, Get, HttpCode, Param, ParseUUIDPipe, Post, Query, UseGuards } from "@nestjs/common";
import {
  AdminAuditQuery,
  type AdminAuditPage,
  type AdminBacklogs,
  type AdminMe,
  type AdminRetryResult,
  type AdminServiceHealth,
} from "@snapurl/contract";
import { zodQuery } from "../common/zod.pipe.js";
import { AdminGuard, Admin, AdminRequestIp } from "./admin.guard.js";
import type { AdminIdentity } from "./admin.service.js";
import { AdminHealthService } from "./admin.health.service.js";

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
  constructor(private readonly health: AdminHealthService) {}

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
}
