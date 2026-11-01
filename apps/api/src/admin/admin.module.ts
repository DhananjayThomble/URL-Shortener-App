import { Module } from "@nestjs/common";
import type { Database } from "@snapurl/database";
import { READ_DB } from "../database/database.module.js";
import { ENV, type Env } from "../config/env.js";
import { AdminController } from "./admin.controller.js";
import { AdminService } from "./admin.service.js";
import { AdminHealthService } from "./admin.health.service.js";
import { AdminGuard } from "./admin.guard.js";
import { AdminManagementService } from "./admin-management.service.js";
import { AuthModule } from "../auth/auth.module.js";
import { WorkspacesModule } from "../workspaces/workspaces.module.js";
import { AdminAnalyticsService } from "./analytics/admin-analytics.service.js";
import { ADMIN_ANALYTICS_READER, PostgresAdminAnalyticsReader } from "./analytics/admin-analytics.reader.js";
import {
  EMAIL_STATS_READER,
  SesEmailStatsReader,
  UnavailableEmailStatsReader,
  makeSesClient,
  type EmailStatsReader,
} from "./analytics/email-stats.reader.js";

/* #968 — the platform-admin module. AdminService resolves the role from the
   live user row + PLATFORM_ADMIN_EMAILS; AdminGuard enforces it on every route.
   #969 adds AdminManagementService (users/workspaces tools), which reaches
   TokenService (AuthModule) to revoke sessions and WorkspaceRemovalService
   (WorkspacesModule) to delete a sole-owned workspace cleanly; MailService is
   global. #974 adds AdminHealthService (system health, backlogs, audited
   retries, audit viewers). #973 adds the platform-wide analytics: its reader
   reads the daily summary tables off the read replica (same token+useFactory
   seam as analytics.module and database.module), and the SES email figures sit
   behind EmailStatsReader. DB and ENV come from the global
   DatabaseModule/ConfigModule. */
@Module({
  imports: [AuthModule, WorkspacesModule],
  controllers: [AdminController],
  providers: [
    AdminService,
    AdminHealthService,
    AdminGuard,
    AdminManagementService,
    AdminAnalyticsService,
    {
      provide: ADMIN_ANALYTICS_READER,
      inject: [READ_DB],
      useFactory: (readDb: Database) => new PostgresAdminAnalyticsReader(readDb),
    },
    // SES figures: read the real account when the app is actually sending
    // through SES (MAIL_TRANSPORT=ses), otherwise report "unavailable" — the
    // honest answer for outbox/local/self-host. The SES reader itself also
    // falls back to unavailable if the call fails, so a missing grant or a
    // throttle never 500s the analytics page.
    {
      provide: EMAIL_STATS_READER,
      inject: [ENV],
      useFactory: (env: Env): EmailStatsReader =>
        env.MAIL_TRANSPORT === "ses"
          ? new SesEmailStatsReader(makeSesClient(env.AWS_REGION))
          : new UnavailableEmailStatsReader(),
    },
  ],
  exports: [AdminService],
})
export class AdminModule {}
