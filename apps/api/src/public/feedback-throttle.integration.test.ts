import "reflect-metadata";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { Controller, Module } from "@nestjs/common";
import { APP_GUARD, NestFactory } from "@nestjs/core";
import { ThrottlerModule } from "@nestjs/throttler";
import { FastifyAdapter, type NestFastifyApplication } from "@nestjs/platform-fastify";
import { MemoryCacheStore } from "@snapurl/cache";

import { PublicController } from "./public.controller.js";
import type { FeedbackService } from "../feedback/feedback.service.js";
import { ProxyAwareThrottlerGuard } from "../common/proxy-aware-throttler.guard.js";
import { CacheStoreThrottlerStorage } from "../common/cache-throttler-storage.js";
import { PlatformSettingsService } from "../admin/platform-settings.service.js";
import { ENV } from "../config/env.js";

/* ============================================================
   #997 — the in-app "Report a problem" intake is rate-limited, and the N+1th
   submit from one IP is refused.

   This drives the REAL guard pipeline (ProxyAwareThrottlerGuard as APP_GUARD
   over the real ThrottlerModule + CacheStoreThrottlerStorage) through a genuine
   Fastify HTTP server, because the @Throttle decorator only takes effect
   through that pipeline — a direct controller-method call never touches it.
   Mirrors register-throttle.integration.test.ts (#658).

   Oracle (issue acceptance "Rate limit refuses the N+1th submission"):
     - the 10 submits within the window from ONE IP all succeed (200);
     - the 11th is refused with 429;
     - a DIFFERENT IP still has its own fresh budget (the limit is per-IP);
     - it works for a SIGNED-OUT caller — every request here carries no
       Authorization header, so the public route must accept them.

   Proof it catches the bug: remove @Throttle({ limit: 10 }) from submitFeedback
   and the route falls under the generous global limit (100/min here), so the
   11th returns the handler's 200, not 429 — the first assertion fails.
   ============================================================ */

const CLIENT_A = "203.0.113.110";
const CLIENT_B = "203.0.113.120";
const PROXY = "198.51.100.1";
const xff = (client: string) => `${client}, ${PROXY}`;

/* The feedback route is the only one exercised; every submit returns a fake id
   so a 200 means "passed the throttle gate and reached the handler". */
const feedbackStub = {
  submit: async () => ({ ok: true, id: "fb-stub" }),
} as unknown as FeedbackService;

/* The other PublicController deps are never called by the feedback route; empty
   stubs satisfy the subclass super() call. */
const unused = {} as never;

const envStub = { TRUSTED_PROXY_HOPS: 1 } as never;
const settingsStub = {
  getValues: async () => ({ rateLimit: { limit: 100, ttlSeconds: 60 } }),
} as unknown as PlatformSettingsService;

/* A test-local subclass whose constructor is plain TypeScript, so Nest needs no
   reflected paramtypes (the vitest/esbuild transform does not emit them). It
   inherits every route + @Throttle + @Public metadatum from
   PublicController.prototype, so the guard pipeline is byte-identical to the
   real controller's. */
@Controller("public")
class TestPublicController extends PublicController {
  constructor() {
    super(unused, unused, unused, feedbackStub, unused, unused, unused);
  }
}
Reflect.defineMetadata("design:paramtypes", [], TestPublicController);
Reflect.defineMetadata("self:paramtypes", [], TestPublicController);

@Module({
  imports: [
    ThrottlerModule.forRoot({
      throttlers: [{ ttl: 60_000, limit: 100 }],
      storage: new CacheStoreThrottlerStorage(new MemoryCacheStore()),
    }),
  ],
  controllers: [TestPublicController],
  providers: [
    { provide: ENV, useValue: envStub },
    { provide: PlatformSettingsService, useValue: settingsStub },
    { provide: APP_GUARD, useClass: ProxyAwareThrottlerGuard },
  ],
})
class FeedbackThrottleTestModule {}

describe("public feedback intake per-IP throttle (#997)", () => {
  let app: NestFastifyApplication;

  beforeAll(async () => {
    app = await NestFactory.create<NestFastifyApplication>(
      FeedbackThrottleTestModule,
      new FastifyAdapter({ trustProxy: false }),
      { logger: false },
    );
    await app.init();
    await app.getHttpAdapter().getInstance().ready();
  });

  afterAll(async () => {
    await app.close();
  });

  const submit = (clientIp: string) =>
    app.inject({
      method: "POST",
      url: "/public/feedback",
      // No Authorization header — a signed-out visitor on a public page.
      headers: { "content-type": "application/json", "x-forwarded-for": xff(clientIp) },
      payload: { message: "Something is broken on this page." },
    });

  it("allows 10 submits from one IP within the window and refuses the 11th with 429", async () => {
    for (let i = 1; i <= 10; i++) {
      const res = await submit(CLIENT_A);
      expect(res.statusCode, `submit #${i} should be within budget`).toBe(200);
    }
    const eleventh = await submit(CLIENT_A);
    expect(eleventh.statusCode).toBe(429);
  });

  it("throttles per IP — a different IP still gets its own fresh budget", async () => {
    // CLIENT_A is exhausted from the previous test (same window). A fresh IP
    // must be unaffected; a global limit would already 429 this first call.
    const first = await submit(CLIENT_B);
    expect(first.statusCode).toBe(200);
  });
});
