import { Body, Controller, Delete, Get, HttpCode, Param, ParseUUIDPipe, Patch, Post, Put, Query, Res, UseGuards } from "@nestjs/common";
import type { FastifyReply } from "fastify";
import {
  AddBlockedDomainInput,
  AdminAbuseQueueQuery,
  AdminAbuseReportAction,
  AdminAnalyticsCsvView,
  AdminAnalyticsQuery,
  AdminAuditQuery,
  AdminLinkDisableInput,
  AdminLinkSearchQuery,
  AdminListQuery,
  AdminRefundInput,
  AdminUpdateWorkspaceInput,
  PlatformSettingsInput,
  type AdminAbuseQueuePage,
  type AdminRefundResult,
  type AdminRevenue,
  type AdminSubscriptionList,
  type AdminWorkspaceBillingEvents,
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
  type PlatformAnalytics,
  type PlatformSettings,
} from "@snapurl/contract";
import {
  FeedbackListQuery,
  UpdateFeedbackInput,
  type FeedbackDetail,
  type FeedbackPage,
} from "@snapurl/contract";
import {
  CreateCouponInput,
  SetCouponPausedInput,
  type CouponList,
  type CouponRedemptionList,
  type CouponView,
} from "@snapurl/contract";
import { zodBody, zodQuery } from "../common/zod.pipe.js";
import { AdminGuard, Admin, AdminRequestIp } from "./admin.guard.js";
import type { AdminIdentity } from "./admin.service.js";
import { AdminHealthService } from "./admin.health.service.js";
import { AdminModerationService } from "./admin.moderation.service.js";
import { AdminFeedbackService } from "./admin.feedback.service.js";
import { AdminManagementService, type AdminActor } from "./admin-management.service.js";
import { AdminAnalyticsService } from "./analytics/admin-analytics.service.js";
import { AdminBillingService } from "./billing/admin-billing.service.js";
import { AdminCouponsService } from "./billing/admin-coupons.service.js";
import { PlatformSettingsService } from "./platform-settings.service.js";
import { PlansAdminService } from "../plans/plans-admin.service.js";
import {
  AdminPlanChangeInput,
  CreatePlanInput,
  MigrateWorkspaceVersionInput,
  SetOverrideInput,
  UpdatePlanInput,
  UpdatePlanMatrixInput,
  UpdatePlanPricesInput,
  type AdminPlanChangeResult,
  type OverrideView,
  type PlanHistoryList,
  type PlanList,
  type PlanView,
} from "@snapurl/contract";
import { PlanManagementService } from "../plans/plan-management.service.js";

/* ============================================================
   #968 + #974 + #969 + #971 + #973 — the platform-admin API surface (/api/v1/admin/*).

   Every route is behind AdminGuard, so reaching any handler already means the
   caller is a confirmed platform admin (verified allow-listed email + 2FA).
   #968 shipped GET /admin/me; #974 adds system health and operations; #969 adds
   the users-and-workspaces tools; #971 adds moderation and abuse; #973 adds the
   platform-wide analytics the admin panel reads. Every WRITE (the #969
   management actions, the #974 retries/release, the #971 moderation actions)
   records a row in the platform audit log through its service; the analytics
   and health READ routes do not audit.
   ============================================================ */
@Controller("admin")
@UseGuards(AdminGuard)
export class AdminController {
  constructor(
    private readonly health: AdminHealthService,
    private readonly moderation: AdminModerationService,
    private readonly feedback: AdminFeedbackService,
    private readonly management: AdminManagementService,
    private readonly adminAnalytics: AdminAnalyticsService,
    private readonly adminBilling: AdminBillingService,
    private readonly adminCoupons: AdminCouponsService,
    private readonly settings: PlatformSettingsService,
    private readonly plansAdmin: PlansAdminService,
    private readonly planManagement: PlanManagementService,
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

  /* ── plans, versions and per-workspace overrides (#970) ── */

  /** Every plan with its current version's feature matrix and limits. */
  @Get("plans")
  listPlans(): Promise<PlanList> {
    return this.plansAdmin.list();
  }

  /** Create a plan and its first version. */
  @Post("plans")
  @HttpCode(201)
  createPlan(
    @Body(zodBody(CreatePlanInput)) input: CreatePlanInput,
    @Admin() admin: AdminIdentity,
    @AdminRequestIp() ip: string | null,
  ): Promise<PlanView> {
    return this.plansAdmin.create(input, actor(admin, ip));
  }

  /** Edit a plan's metadata (name, description, badge, sort, visibility). Does
   *  not version the feature matrix — that is the matrix route. */
  @Patch("plans/:id")
  updatePlan(
    @Param("id", ParseUUIDPipe) id: string,
    @Body(zodBody(UpdatePlanInput)) input: UpdatePlanInput,
    @Admin() admin: AdminIdentity,
    @AdminRequestIp() ip: string | null,
  ): Promise<PlanView> {
    return this.plansAdmin.update(id, input, actor(admin, ip));
  }

  /** Edit a live plan's feature matrix / limits. Creates a new version; existing
   *  workspaces stay grandfathered on the old one. */
  @Put("plans/:id/matrix")
  editPlanMatrix(
    @Param("id", ParseUUIDPipe) id: string,
    @Body(zodBody(UpdatePlanMatrixInput)) input: UpdatePlanMatrixInput,
    @Admin() admin: AdminIdentity,
    @AdminRequestIp() ip: string | null,
  ): Promise<PlanView> {
    return this.plansAdmin.editMatrix(id, input, actor(admin, ip));
  }

  /** #987 — edit a live plan's PRICES. Creates a new version (same matrix +
   *  limits, new prices); existing subscribers stay grandfathered on the old
   *  price, and the new price is synced to the billing provider. Audited. */
  @Put("plans/:id/prices")
  editPlanPrices(
    @Param("id", ParseUUIDPipe) id: string,
    @Body(zodBody(UpdatePlanPricesInput)) input: UpdatePlanPricesInput,
    @Admin() admin: AdminIdentity,
    @AdminRequestIp() ip: string | null,
  ): Promise<PlanView> {
    return this.plansAdmin.editPrices(id, input, actor(admin, ip));
  }

  /** The per-workspace overrides on a workspace. */
  @Get("workspaces/:id/overrides")
  listOverrides(@Param("id", ParseUUIDPipe) id: string): Promise<{ items: OverrideView[] }> {
    return this.plansAdmin.listOverrides(id);
  }

  /** Set (or replace) a per-workspace feature/limit override, optionally with an
   *  expiry. An override beats the plan. */
  @Post("workspaces/:id/overrides")
  @HttpCode(201)
  setOverride(
    @Param("id", ParseUUIDPipe) id: string,
    @Body(zodBody(SetOverrideInput)) input: SetOverrideInput,
    @Admin() admin: AdminIdentity,
    @AdminRequestIp() ip: string | null,
  ): Promise<OverrideView> {
    return this.plansAdmin.setOverride(id, input, actor(admin, ip));
  }

  /** Remove a per-workspace override by id. */
  @Delete("workspaces/:id/overrides/:overrideId")
  @HttpCode(204)
  async removeOverride(
    @Param("id", ParseUUIDPipe) id: string,
    @Param("overrideId", ParseUUIDPipe) overrideId: string,
    @Admin() admin: AdminIdentity,
    @AdminRequestIp() ip: string | null,
  ): Promise<void> {
    await this.plansAdmin.removeOverride(id, overrideId, actor(admin, ip));
  }

  /** Pin (or unpin) a workspace to a specific plan version — the grandfather
   *  migration control. */
  @Post("workspaces/:id/migrate-version")
  @HttpCode(204)
  async migrateWorkspaceVersion(
    @Param("id", ParseUUIDPipe) id: string,
    @Body(zodBody(MigrateWorkspaceVersionInput)) input: MigrateWorkspaceVersionInput,
    @Admin() admin: AdminIdentity,
    @AdminRequestIp() ip: string | null,
  ): Promise<void> {
    await this.plansAdmin.migrateWorkspaceVersion(id, input, actor(admin, ip));
  }

  /* ── admin plan change + plan history (#992) ── */

  /** #992 §1 (PR-A) — move a workspace's plan: immediately as a comp (grant
   *  without payment, optional revert date) or at the end of the current period.
   *  A reason is required; the change is audited and lands in the workspace's
   *  plan history. Refused with 409 when a live provider subscription owns the
   *  plan (needs the provider-backed path, PR-C). A real prorated charge is PR-C. */
  @Post("workspaces/:id/plan-change")
  changeWorkspacePlan(
    @Param("id", ParseUUIDPipe) id: string,
    @Body(zodBody(AdminPlanChangeInput)) input: AdminPlanChangeInput,
    @Admin() admin: AdminIdentity,
    @AdminRequestIp() ip: string | null,
  ): Promise<AdminPlanChangeResult> {
    return this.planManagement.adminChangePlan(id, input, actor(admin, ip));
  }

  /** #992 §7 — a workspace's plan history: every change, comp, payment, refund
   *  and cancellation, newest first. */
  @Get("workspaces/:id/plan-history")
  workspacePlanHistory(@Param("id", ParseUUIDPipe) id: string): Promise<PlanHistoryList> {
    return this.planManagement.history(id);
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

  /* ---- #997 "Report a problem" feedback inbox ---- */

  /** The feedback inbox, newest first, optionally filtered by status. A read
   *  (no audit). The list omits the screenshot blob and reports only whether
   *  one is attached. */
  @Get("feedback")
  listFeedback(@Query(zodQuery(FeedbackListQuery)) q: FeedbackListQuery): Promise<FeedbackPage> {
    return this.feedback.list(q);
  }

  /** One feedback report in full, including its screenshot data URL. A read. */
  @Get("feedback/:id")
  getFeedback(@Param("id", ParseUUIDPipe) id: string): Promise<FeedbackDetail> {
    return this.feedback.get(id);
  }

  /** Move a report's status and/or set operator notes. Audited. */
  @Patch("feedback/:id")
  updateFeedback(
    @Param("id", ParseUUIDPipe) id: string,
    @Body(zodBody(UpdateFeedbackInput)) input: UpdateFeedbackInput,
    @Admin() admin: AdminIdentity,
    @AdminRequestIp() ip: string | null,
  ): Promise<FeedbackDetail> {
    return this.feedback.update(id, input, admin, ip);
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

  /* ---- #989 billing views + admin refund ---- */

  /** Every subscription with its workspace, plan and lifecycle state. A read
   *  (no audit). */
  @Get("subscriptions")
  subscriptions(): Promise<AdminSubscriptionList> {
    return this.adminBilling.subscriptions();
  }

  /** The revenue headline: MRR, active subscribers by plan, churn, failed
   *  payments, subscriptions in grace. A read (no audit). */
  @Get("revenue")
  revenue(): Promise<AdminRevenue> {
    return this.adminBilling.revenue();
  }

  /** One workspace's billing-event history, newest first. A read (no audit). */
  @Get("workspaces/:id/billing-events")
  workspaceBillingEvents(@Param("id", ParseUUIDPipe) id: string): Promise<AdminWorkspaceBillingEvents> {
    return this.adminBilling.workspaceEvents(id);
  }

  /** Refund a payment through the provider's refund API, with a required
   *  reason. Admin-only (guard) and AUDITED — there is no self-serve refund. */
  @Post("payments/:id/refund")
  @HttpCode(200)
  refundPayment(
    @Param("id", ParseUUIDPipe) id: string,
    @Body(zodBody(AdminRefundInput)) input: AdminRefundInput,
    @Admin() admin: AdminIdentity,
    @AdminRequestIp() ip: string | null,
  ): Promise<AdminRefundResult> {
    return this.adminBilling.refund(id, input.reason, actor(admin, ip));
  }

  /* ---- #992 coupons: create, list, pause/resume, delete, redemptions ---- */

  /** Every coupon, newest first, each with its live redemption count. A read
   *  (no audit). */
  @Get("coupons")
  listCoupons(): Promise<CouponList> {
    return this.adminCoupons.list();
  }

  /** Create a coupon. Admin-only (guard) and AUDITED. A duplicate code is a
   *  409 (the unique index, mapped by the Postgres-error filter). */
  @Post("coupons")
  createCoupon(
    @Body(zodBody(CreateCouponInput)) input: CreateCouponInput,
    @Admin() admin: AdminIdentity,
    @AdminRequestIp() ip: string | null,
  ): Promise<CouponView> {
    return this.adminCoupons.create(input, actor(admin, ip));
  }

  /** Pause or resume a coupon (no new redemptions while paused; past ones keep
   *  running). Admin-only and AUDITED. */
  @Post("coupons/:id/pause")
  setCouponPaused(
    @Param("id", ParseUUIDPipe) id: string,
    @Body(zodBody(SetCouponPausedInput)) input: SetCouponPausedInput,
    @Admin() admin: AdminIdentity,
    @AdminRequestIp() ip: string | null,
  ): Promise<CouponView> {
    return this.adminCoupons.setPaused(id, input.paused, actor(admin, ip));
  }

  /** Delete a coupon (its redemptions cascade). Admin-only and AUDITED. */
  @Delete("coupons/:id")
  @HttpCode(200)
  async deleteCoupon(
    @Param("id", ParseUUIDPipe) id: string,
    @Admin() admin: AdminIdentity,
    @AdminRequestIp() ip: string | null,
  ): Promise<AdminActionResult> {
    await this.adminCoupons.remove(id, actor(admin, ip));
    return { id, action: "delete", ok: true };
  }

  /** The redemptions of one coupon, newest first. A read (no audit). */
  @Get("coupons/:id/redemptions")
  couponRedemptions(@Param("id", ParseUUIDPipe) id: string): Promise<CouponRedemptionList> {
    return this.adminCoupons.redemptions(id);
  }
}

/** Fold the two guard-supplied params into the service's AdminActor. */
function actor(admin: AdminIdentity, ip: string | null): AdminActor {
  return { admin, ip };
}
