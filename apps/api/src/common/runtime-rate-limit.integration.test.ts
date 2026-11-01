import "reflect-metadata";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { Controller, Get, Module } from "@nestjs/common";
import { APP_GUARD, NestFactory } from "@nestjs/core";
import { ThrottlerModule, Throttle } from "@nestjs/throttler";
import { FastifyAdapter, type NestFastifyApplication } from "@nestjs/platform-fastify";
import { MemoryCacheStore } from "@snapurl/cache";

import { ProxyAwareThrottlerGuard } from "./proxy-aware-throttler.guard.js";
import { CacheStoreThrottlerStorage } from "./cache-throttler-storage.js";
import { PlatformSettingsService } from "../admin/platform-settings.service.js";
import { ENV } from "../config/env.js";

/* ============================================================
   #972 — the GLOBAL rate limit is a runtime setting.

   Drives the REAL guard pipeline (ProxyAwareThrottlerGuard as APP_GUARD over
   the real ThrottlerModule + CacheStoreThrottlerStorage) with a genuine Fastify
   server, because only through that pipeline does the guard's handleRequest
   override run. Two controller routes:

     - GET /plain      — NO @Throttle, so it falls under the module default and
                         MUST be governed by the runtime setting;
     - GET /decorated  — @Throttle({ default: { limit: 3 } }), a route-level
                         limit that MUST be left exactly as declared and NOT be
                         overridden by the runtime setting.

   The PlatformSettingsService is a mutable stub whose rateLimit the test
   changes between requests — standing in for an admin changing it from the
   panel — so "applies without a restart" is proven against ONE running app: no
   new NestFactory.create between the before and after limits.

   Oracle = the acceptance line "a changed rate limit applies without a restart".

   Red-on-broken:
     - if the override is dropped, /plain uses the module default (100) and the
       "limited to 2" assertion fails;
     - if the override wrongly applies to decorated routes, /decorated's 3/min
       would become the runtime value and its assertion fails;
     - if the change needed a restart, the post-change assertion (same app,
       higher limit) fails.
   ============================================================ */

const CLIENT = "203.0.113.77";
const PROXY = "198.51.100.9";
const xff = `${CLIENT}, ${PROXY}`;
const envStub = { TRUSTED_PROXY_HOPS: 1 } as never;

/* Mutable: the test reassigns `rateLimit` to simulate an admin change, and the
   guard reads it fresh on each request (its own cache is bypassed here because
   this stub returns the live object every call). */
const settingsStub = {
  rateLimit: { limit: 2, ttlSeconds: 60 },
  async getValues() {
    return { rateLimit: this.rateLimit };
  },
} as unknown as PlatformSettingsService & { rateLimit: { limit: number; ttlSeconds: number } };

@Controller()
class ProbeController {
  @Get("plain")
  plain() {
    return { ok: true };
  }

  @Throttle({ default: { limit: 3, ttl: 60_000 } })
  @Get("decorated")
  decorated() {
    return { ok: true };
  }
}

@Module({
  imports: [
    // Generous module default so any limiting the test sees on /plain comes
    // from the runtime setting, not this number.
    ThrottlerModule.forRoot({
      throttlers: [{ ttl: 60_000, limit: 100 }],
      storage: new CacheStoreThrottlerStorage(new MemoryCacheStore()),
    }),
  ],
  controllers: [ProbeController],
  providers: [
    { provide: ENV, useValue: envStub },
    { provide: PlatformSettingsService, useValue: settingsStub },
    { provide: APP_GUARD, useClass: ProxyAwareThrottlerGuard },
  ],
})
class RuntimeLimitTestModule {}

describe("#972 — runtime global rate limit", () => {
  let app: NestFastifyApplication;

  beforeAll(async () => {
    app = await NestFactory.create<NestFastifyApplication>(
      RuntimeLimitTestModule,
      new FastifyAdapter({ trustProxy: false }),
      { logger: false },
    );
    await app.init();
    await app.getHttpAdapter().getInstance().ready();
  });

  afterAll(async () => {
    await app.close();
  });

  const hit = (url: string) =>
    app.inject({ method: "GET", url, headers: { "x-forwarded-for": xff } });

  it("governs an undecorated route by the runtime setting (limit 2), not the module default", async () => {
    settingsStub.rateLimit = { limit: 2, ttlSeconds: 60 };
    expect((await hit("/plain")).statusCode).toBe(200);
    expect((await hit("/plain")).statusCode).toBe(200);
    // The 3rd within the window exceeds the runtime limit of 2.
    expect((await hit("/plain")).statusCode).toBe(429);
  });

  it("leaves a route-level @Throttle limit alone (its own 3/min, not the runtime value)", async () => {
    // Runtime limit is 2, but /decorated declares 3 — it must get 3, proving the
    // override does not touch a route that set its own limit.
    expect((await hit("/decorated")).statusCode).toBe(200);
    expect((await hit("/decorated")).statusCode).toBe(200);
    expect((await hit("/decorated")).statusCode).toBe(200);
    expect((await hit("/decorated")).statusCode).toBe(429);
  });

  it("a raised limit applies without a restart (same running app)", async () => {
    // Simulate an admin raising the global limit. No new app is created.
    settingsStub.rateLimit = { limit: 50, ttlSeconds: 60 };
    // A fresh client IP so the previous window does not interfere.
    const other = "203.0.113.88";
    const inject = () =>
      app.inject({ method: "GET", url: "/plain", headers: { "x-forwarded-for": `${other}, ${PROXY}` } });
    for (let i = 0; i < 10; i++) {
      expect((await inject()).statusCode, `request #${i + 1} should be within the raised limit`).toBe(200);
    }
  });
});
