import { Controller, Get, HttpCode, Param, ParseUUIDPipe, Post, Query, Res, UseGuards } from "@nestjs/common";
import type { FastifyReply } from "fastify";
import {
  AdminAnalyticsCsvView,
  AdminAnalyticsQuery,
  AdminAuditQuery,
  type AdminAuditPage,
  type AdminBacklogs,
  type AdminMe,
  type AdminRetryResult,
  type AdminServiceHealth,
  type PlatformAnalytics,
} from "@snapurl/contract";
import { zodQuery } from "../common/zod.pipe.js";
import { AdminGuard, Admin, AdminRequestIp } from "./admin.guard.js";
import type { AdminIdentity } from "./admin.service.js";
import { AdminHealthService } from "./admin.health.service.js";
import { AdminAnalyticsService } from "./analytics/admin-analytics.service.js";

/* ============================================================
   #968 — the platform-admin API surface (/api/v1/admin/*).

   Every route is behind AdminGuard, so reaching any handler here already means
   the caller is a confirmed platform admin (verified allow-listed email + 2FA).
   #968 shipped GET /admin/me; #974 added system health + operations; #973 adds
   the platform-wide analytics the admin panel reads. Later parts of the epic
   (#975) add their own operations, each WRITE of which records through
   writeAdminAuditEntry — the analytics and health READ routes here do not audit;
   the health RETRY/RELEASE writes do.
   ============================================================ */
@Controller("admin")
@UseGuards(AdminGuard)
export class AdminController {
  constructor(
    private readonly health: AdminHealthService,
    private readonly adminAnalytics: AdminAnalyticsService,
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

  /* ---- #973 platform-wide analytics ---- */

  /** #973 — platform-wide analytics: growth, usage, business, email and abuse
   *  figures over the selected range, all from the daily summary tables. With
   *  `compare=true` the response also carries the previous window's headlines. */
  @Get("analytics")
  analytics(@Query(zodQuery(AdminAnalyticsQuery)) query: AdminAnalyticsQuery): Promise<PlatformAnalytics> {
    return this.adminAnalytics.platform(query);
  }

  /**
   * #973 — CSV export of one analytics view. A read (no audit). The view is a
   * path param validated against the contract enum; the range/compare query is
   * the same as the JSON route.
   *
   * `passthrough: true` keeps Fastify's reply pipeline (and the CORS headers it
   * already set) in play while still letting us set the filename per view —
   * returning the string then lets Nest send it with the headers below.
   */
  @Get("analytics/export/:view")
  async analyticsCsv(
    @Param("view") view: string,
    @Query(zodQuery(AdminAnalyticsQuery)) query: AdminAnalyticsQuery,
    @Res({ passthrough: true }) reply: FastifyReply,
  ): Promise<string> {
    // Validate the view against the contract enum at the edge, so an unknown
    // view is a clean 400 naming the allowed values rather than a thrown 500
    // from the service's exhaustive switch.
    const parsed = AdminAnalyticsCsvView.parse(view);
    reply.header("Content-Type", "text/csv; charset=utf-8");
    reply.header("Content-Disposition", `attachment; filename="snapurl-admin-${parsed}-${query.range}.csv"`);
    return this.adminAnalytics.csv(query, parsed);
  }
}
