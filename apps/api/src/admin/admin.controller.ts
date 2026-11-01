import { Body, Controller, Delete, Get, HttpCode, Param, ParseUUIDPipe, Patch, Post, Query, UseGuards } from "@nestjs/common";
import {
  AdminListQuery,
  AdminUpdateWorkspaceInput,
  type AdminActionResult,
  type AdminMe,
  type AdminUserDetail,
  type AdminUserList,
  type AdminViewAsWorkspace,
  type AdminWorkspaceDetail,
  type AdminWorkspaceList,
} from "@snapurl/contract";
import { zodBody, zodQuery } from "../common/zod.pipe.js";
import { AdminGuard, Admin, AdminRequestIp } from "./admin.guard.js";
import type { AdminIdentity } from "./admin.service.js";
import { AdminManagementService, type AdminActor } from "./admin-management.service.js";

/* ============================================================
   #968 + #969 — the platform-admin API surface (/api/v1/admin/*).

   Every route is behind AdminGuard, so reaching any handler already means the
   caller is a confirmed platform admin (verified allow-listed email + 2FA).
   #968 shipped GET /admin/me; #969 adds the users-and-workspaces tools, each
   write of which records a row in the platform audit log through the service.
   ============================================================ */
@Controller("admin")
@UseGuards(AdminGuard)
export class AdminController {
  constructor(private readonly management: AdminManagementService) {}

  /** Who the caller is, confirmed as a platform admin. */
  @Get("me")
  me(@Admin() admin: AdminIdentity): AdminMe {
    return { id: admin.id, name: admin.name, email: admin.email, isPlatformAdmin: true };
  }

  /* ── users ── */

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

  /* ── workspaces ── */

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
}

/** Fold the two guard-supplied params into the service's AdminActor. */
function actor(admin: AdminIdentity, ip: string | null): AdminActor {
  return { admin, ip };
}
