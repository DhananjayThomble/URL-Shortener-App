import { Module } from "@nestjs/common";
import { AdminController } from "./admin.controller.js";
import { AdminService } from "./admin.service.js";
import { AdminHealthService } from "./admin.health.service.js";
import { AdminModerationService } from "./admin.moderation.service.js";
import { AdminGuard } from "./admin.guard.js";

/* #968 — the platform-admin module. AdminService resolves the role from the
   live user row + PLATFORM_ADMIN_EMAILS; AdminGuard enforces it on every route.
   #974 adds AdminHealthService (system health, backlogs, audited retries, audit
   viewers). #971 adds AdminModerationService (abuse queue, link search,
   disable/enable, destination blocklist, flagged + custom-domain lists). DB,
   ENV and the shared ProjectionNudge/LinkCacheBust services come from the
   global DatabaseModule/ConfigModule/CommonModule. */
@Module({
  controllers: [AdminController],
  providers: [AdminService, AdminHealthService, AdminModerationService, AdminGuard],
  exports: [AdminService],
})
export class AdminModule {}
