import { Module } from "@nestjs/common";
import { APP_FILTER, APP_GUARD } from "@nestjs/core";
import { ThrottlerModule } from "@nestjs/throttler";
import { LoggerModule } from "nestjs-pino";

import { createCacheStore } from "@snapurl/cache";

import { ConfigModule } from "./config/config.module.js";
import { ENV, loadEnv, type Env } from "./config/env.js";
import { CacheStoreThrottlerStorage } from "./common/cache-throttler-storage.js";
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
import { FormsModule } from "./forms/forms.module.js";
import { ReportsModule } from "./reports/reports.module.js";
import { PostgresErrorFilter } from "./common/postgres-error.filter.js";
import { ProxyAwareThrottlerGuard } from "./common/proxy-aware-throttler.guard.js";

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
      /* Back the throttler with a CacheStore selected by CACHE_DRIVER. The
         default 'memory' driver is a Map-backed atomic counter — behaviourally
         the stock in-memory storage, so single-node/CI limits are unchanged.
         With CACHE_DRIVER=redis + REDIS_URL the counter is SHARED across
         instances, which is the multi-instance fix (the effective limit stops
         being limit x instances). The factory is async because of its lazy
         redis/dynamodb imports, so the useFactory is async too. */
      useFactory: async (env: Env) => ({
        throttlers: [{ ttl: env.THROTTLE_TTL_SECONDS * 1000, limit: env.THROTTLE_LIMIT }],
        storage: new CacheStoreThrottlerStorage(
          await createCacheStore({
            driver: env.CACHE_DRIVER,
            redisUrl: env.REDIS_URL,
            dynamoTable: env.CACHE_DYNAMO_TABLE,
          }),
        ),
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
    FormsModule,
    ReportsModule,
    PublicModule,
  ],
  controllers: [HealthController],
  providers: [
    /* Authentication is on by default for every route in the application.
       Routes opt out with @Public(). The inverse — a guard applied per
       controller — means a new controller is unprotected until someone
       remembers, and that is the kind of mistake nobody notices. */
    { provide: APP_GUARD, useClass: AuthGuard },
    /* ProxyAwareThrottlerGuard replaces the stock ThrottlerGuard so limits key
       on the trustworthy client IP (rightmost-minus-N X-Forwarded-For entry)
       rather than the client-typed leftmost one. Order relative to AuthGuard
       is unchanged. */
    { provide: APP_GUARD, useClass: ProxyAwareThrottlerGuard },
    /* Last line of defence: a constraint violation nobody anticipated
       becomes a 409, not an "Internal server error". */
    { provide: APP_FILTER, useClass: PostgresErrorFilter },
  ],
})
export class AppModule {}

export { loadEnv };
