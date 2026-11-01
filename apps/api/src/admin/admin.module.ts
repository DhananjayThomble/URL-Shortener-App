import { Module } from "@nestjs/common";
import { AdminController } from "./admin.controller.js";
import { AdminService } from "./admin.service.js";
import { AdminHealthService } from "./admin.health.service.js";
import { AdminModerationService } from "./admin.moderation.service.js";
import { AdminGuard } from "./admin.guard.js";
import { AdminManagementService } from "./admin-management.service.js";
import { AuthModule } from "../auth/auth.module.js";
import { WorkspacesModule } from "../workspaces/workspaces.module.js";

/* #968 — the platform-admin module. AdminService resolves the role from the
   live user row + PLATFORM_ADMIN_EMAILS; AdminGuard enforces it on every route.
   #974 adds AdminHealthService (system health, backlogs, audited retries, audit
   viewers). #971 adds AdminModerationService (abuse queue, link search,
   disable/enable, destination blocklist, flagged + custom-domain lists), using
   the shared ProjectionNudge/LinkCacheBust services from the global
   CommonModule. #969 adds AdminManagementService (users/workspaces tools),
   which reaches TokenService (AuthModule) to revoke sessions and
   WorkspaceRemovalService (WorkspacesModule) to delete a sole-owned workspace
   cleanly; MailService is global. DB and ENV come from the global
   DatabaseModule/ConfigModule. */
@Module({
  imports: [AuthModule, WorkspacesModule],
  controllers: [AdminController],
  providers: [AdminService, AdminHealthService, AdminModerationService, AdminGuard, AdminManagementService],
  exports: [AdminService],
})
export class AdminModule {}
