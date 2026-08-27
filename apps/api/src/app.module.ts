import { Module } from "@nestjs/common";
import { APP_FILTER, APP_GUARD } from "@nestjs/core";
import { ThrottlerGuard, ThrottlerModule } from "@nestjs/throttler";
import { LoggerModule } from "nestjs-pino";

import { ConfigModule } from "./config/config.module.js";
import { ENV, loadEnv, type Env } from "./config/env.js";
import { DatabaseModule } from "./database/database.module.js";
import { MailModule } from "./mail/mail.module.js";
import { AuthModule } from "./auth/auth.module.js";
import { AuthGuard } from "./auth/auth.guard.js";
import { SafeBrowsingModule } from "./safe-browsing/safe-browsing.module.js";
import { WorkspacesModule } from "./workspaces/workspaces.module.js";
import { LinksModule } from "./links/links.module.js";
import { AnalyticsModule } from "./analytics/analytics.module.js";
import { ConversionsModule } from "./conversions/conversions.module.js";
import { DomainsModule } from "./domains/domains.module.js";
import { MembersModule } from "./members/members.module.js";
import { DevelopersModule } from "./developers/developers.module.js";
import { BioPagesModule } from "./bio-pages/bio-pages.module.js";
import { PublicModule } from "./public/public.module.js";
import { HealthController } from "./common/health.controller.js";
import { PostgresErrorFilter } from "./common/postgres-error.filter.js";

@Module({
  imports: [
    ConfigModule,
    LoggerModule.forRootAsync({
      inject: [ENV],
      useFactory: (env: Env) => ({
        pinoHttp: {
          level: env.LOG_LEVEL,
          // Pretty output is for a human at a terminal. In production the logs
          // go to CloudWatch Logs Insights, which wants raw JSON.
          transport: env.NODE_ENV === "development" ? { target: "pino-pretty", options: { singleLine: true } } : undefined,
          redact: {
            paths: [
              "req.headers.authorization",
              "req.headers.cookie",
              "req.body.password",
              "req.body.refreshToken",
              "res.headers['set-cookie']",
            ],
            remove: true,
          },
          autoLogging: { ignore: (req) => req.url === "/api/v1/health" },
        },
      }),
    }),
    ThrottlerModule.forRootAsync({
      inject: [ENV],
      useFactory: (env: Env) => ({
        throttlers: [{ ttl: env.THROTTLE_TTL_SECONDS * 1000, limit: env.THROTTLE_LIMIT }],
      }),
    }),
    DatabaseModule,
    MailModule,
    AuthModule,
    SafeBrowsingModule,
    WorkspacesModule,
    LinksModule,
    AnalyticsModule,
    ConversionsModule,
    DomainsModule,
    MembersModule,
    DevelopersModule,
    BioPagesModule,
    PublicModule,
  ],
  controllers: [HealthController],
  providers: [
    /* Authentication is on by default for every route in the application.
       Routes opt out with @Public(). The inverse — a guard applied per
       controller — means a new controller is unprotected until someone
       remembers, and that is the kind of mistake nobody notices. */
    { provide: APP_GUARD, useClass: AuthGuard },
    { provide: APP_GUARD, useClass: ThrottlerGuard },
    /* Last line of defence: a constraint violation nobody anticipated
       becomes a 409, not an "Internal server error". */
    { provide: APP_FILTER, useClass: PostgresErrorFilter },
  ],
})
export class AppModule {}

export { loadEnv };
