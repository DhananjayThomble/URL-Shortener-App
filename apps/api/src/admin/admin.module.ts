import { Module } from "@nestjs/common";
import type { Database } from "@snapurl/database";
import { READ_DB } from "../database/database.module.js";
import { AdminController } from "./admin.controller.js";
import { AdminService } from "./admin.service.js";
import { AdminGuard } from "./admin.guard.js";
import { AdminAnalyticsService } from "./analytics/admin-analytics.service.js";
import { ADMIN_ANALYTICS_READER, PostgresAdminAnalyticsReader } from "./analytics/admin-analytics.reader.js";
import { EMAIL_STATS_READER, UnavailableEmailStatsReader } from "./analytics/email-stats.reader.js";

/* #968 — the platform-admin module. AdminService resolves the role from the
   live user row + PLATFORM_ADMIN_EMAILS; AdminGuard enforces it on every route.
   #973 adds the platform-wide analytics: its reader reads the daily summary
   tables off the read replica (same token+useFactory seam as analytics.module
   and database.module), and the SES figures sit behind EmailStatsReader whose
   default binding reports "not available" until a CloudWatch adapter + IAM
   grant land. DB and ENV come from the global DatabaseModule/ConfigModule. */
@Module({
  controllers: [AdminController],
  providers: [
    AdminService,
    AdminGuard,
    AdminAnalyticsService,
    {
      provide: ADMIN_ANALYTICS_READER,
      inject: [READ_DB],
      useFactory: (readDb: Database) => new PostgresAdminAnalyticsReader(readDb),
    },
    // The SES metric source is not wired yet; the default reader reports every
    // email figure as unavailable. A CloudWatch adapter replaces this binding
    // without touching the service — see email-stats.reader.ts.
    { provide: EMAIL_STATS_READER, useClass: UnavailableEmailStatsReader },
  ],
  exports: [AdminService],
})
export class AdminModule {}
