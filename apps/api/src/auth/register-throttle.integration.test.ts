import "reflect-metadata";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { Controller, Module } from "@nestjs/common";
import { APP_GUARD, NestFactory } from "@nestjs/core";
import { ThrottlerModule } from "@nestjs/throttler";
import { FastifyAdapter, type NestFastifyApplication } from "@nestjs/platform-fastify";
import { MemoryCacheStore } from "@snapurl/cache";

import { AuthController } from "./auth.controller.js";
import type { AuthService } from "./auth.service.js";
import { ProxyAwareThrottlerGuard } from "../common/proxy-aware-throttler.guard.js";
import { CacheStoreThrottlerStorage } from "../common/cache-throttler-storage.js";
import { ENV } from "../config/env.js";

/* ============================================================
   Issue #658 — registration reveals an existing email.

   DECISION (posted on the issue, recorded in docs/DECISIONS.md): keep the
   friendly 409 on a duplicate email — register issues a session immediately,
   so the account-exists signal is unavoidable and the UX win is worth it. The
   accepted mitigation is a per-IP throttle on the register route, matching the
   login route's 5/min, so the 409 cannot be used as a cheap bulk-enumeration
   oracle.

   This test drives the REAL guard pipeline (ProxyAwareThrottlerGuard as
   APP_GUARD over the real ThrottlerModule + CacheStoreThrottlerStorage) with a
   genuine Fastify HTTP server, because the @Throttle decorator only takes
   effect through that pipeline — a direct controller method call never touches
   it. AuthService is stubbed: this test is about the throttle gate in front of
   the handler, not what the handler does.

   Oracle (issue #658 + the login throttle it mirrors, auth.controller.ts):
   - the 6th register within the window from ONE IP is rejected with 429;
   - the throttle is PER-IP — a different IP still gets its own fresh budget;
   - login keeps its own independent 5/min budget — an IP that exhausted
     register can still log in (behaviour unchanged).

   PROOF IT CATCHES THE BUG: on the pre-fix controller (register had no
   @Throttle) the register route fell under the global THROTTLE_LIMIT (120/min),
   so the 6th call returns the handler's 200, not 429 — the first assertion
   below fails. The fix (register @Throttle 5/min) is what makes it pass.
   ============================================================ */

/* The register-exhausting IP, the fresh IP, and the login IP are distinct so
   their per-IP counters never collide. TRUSTED_PROXY_HOPS=1 means the guard
   keys on the SECOND-from-right X-Forwarded-For entry, so we send
   "<client>, <trusted-proxy>" and the guard picks <client>. */
const CLIENT_A = "203.0.113.10";
const CLIENT_B = "203.0.113.20";
const CLIENT_C = "203.0.113.30";
const PROXY = "198.51.100.1";
const xff = (client: string) => `${client}, ${PROXY}`;

/* A stub that answers register/login without a database. register returns a
   fake session, exactly as a brand-new signup would; login likewise. The point
   of the test is the gate in front, so the bodies are deliberately trivial. */
const authStub = {
  register: async () => ({ accessToken: "a", refreshToken: "r", user: { id: "u1" } }),
  login: async () => ({ accessToken: "a", refreshToken: "r", user: { id: "u1" } }),
} as unknown as AuthService;

/* Only the field ProxyAwareThrottlerGuard reads. */
const envStub = { TRUSTED_PROXY_HOPS: 1 } as never;

/* The vitest transform (esbuild) does not emit `design:paramtypes`, so Nest
   cannot resolve AuthController's constructor dependency by reflection the way
   `nest build` (tsc, emitDecoratorMetadata) does in production. We sidestep
   that transform gap WITHOUT changing production code or the shared vitest
   config: a test-local subclass whose constructor is plain TypeScript (no
   reflected paramtypes needed) passes the stub to super(). It inherits every
   route + @Throttle + @Public metadatum from AuthController.prototype, so the
   guard pipeline under test is byte-identical to the real controller's — only
   the service wiring is hand-fed. @Controller re-declares the same "auth" base
   path on the subclass. */
@Controller("auth")
class TestAuthController extends AuthController {
  constructor() {
    super(authStub);
  }
}

const REGISTER_BODY = { email: "newcomer@example.com", password: "a-long-enough-password", name: "Newcomer" };
const LOGIN_BODY = { email: "someone@example.com", password: "a-long-enough-password" };

/* A self-contained module standing in for AppModule's throttle wiring: the real
   ThrottlerModule with a generous GLOBAL limit, the real
   CacheStoreThrottlerStorage over an in-memory cache, the AuthController under
   test, a stubbed ENV, and ProxyAwareThrottlerGuard installed as APP_GUARD
   exactly as app.module.ts installs it. Bootstrapped with the same
   FastifyAdapter({ trustProxy: false }) main.ts uses, so getTracker reads the
   X-Forwarded-For the way production does. */
@Module({
  imports: [
    /* Generous GLOBAL limit so any 429 the test sees comes from the register
       route's own 5/min @Throttle, never the global default. Without the
       per-route decorator the global 100/min lets the 6th register through —
       the failure that proves this test exercises the fix. */
    ThrottlerModule.forRoot({
      throttlers: [{ ttl: 60_000, limit: 100 }],
      storage: new CacheStoreThrottlerStorage(new MemoryCacheStore()),
    }),
  ],
  controllers: [TestAuthController],
  providers: [
    { provide: ENV, useValue: envStub },
    { provide: APP_GUARD, useClass: ProxyAwareThrottlerGuard },
  ],
})
class ThrottleTestModule {}

describe("register endpoint per-IP throttle (#658)", () => {
  let app: NestFastifyApplication;

  beforeAll(async () => {
    app = await NestFactory.create<NestFastifyApplication>(
      ThrottleTestModule,
      new FastifyAdapter({ trustProxy: false }),
      { logger: false },
    );
    await app.init();
    await app.getHttpAdapter().getInstance().ready();
  });

  afterAll(async () => {
    await app.close();
  });

  const register = (clientIp: string) =>
    app.inject({
      method: "POST",
      url: "/auth/register",
      headers: { "content-type": "application/json", "x-forwarded-for": xff(clientIp) },
      payload: REGISTER_BODY,
    });

  const login = (clientIp: string) =>
    app.inject({
      method: "POST",
      url: "/auth/login",
      headers: { "content-type": "application/json", "x-forwarded-for": xff(clientIp) },
      payload: LOGIN_BODY,
    });

  it("allows 5 registers from one IP within the window and rejects the 6th with 429", async () => {
    for (let i = 1; i <= 5; i++) {
      const res = await register(CLIENT_A);
      expect(res.statusCode, `register #${i} should be within budget`).toBeLessThan(400);
    }
    const sixth = await register(CLIENT_A);
    expect(sixth.statusCode).toBe(429);
  });

  it("throttles per IP — a different IP still gets its own fresh budget", async () => {
    /* CLIENT_A is already exhausted from the previous test (same window). A
       fresh IP must be unaffected: if the limit were global rather than per-IP,
       this first call from CLIENT_B would already 429. */
    const first = await register(CLIENT_B);
    expect(first.statusCode).toBeLessThan(400);
  });

  it("leaves login's own budget independent — an IP that exhausted register can still log in", async () => {
    /* CLIENT_C exhausts register, then logs in. Login has its own 5/min counter
       (separate route), so the register throttle must not spill into it. */
    for (let i = 1; i <= 5; i++) await register(CLIENT_C);
    const registerBlocked = await register(CLIENT_C);
    expect(registerBlocked.statusCode).toBe(429);

    const loginRes = await login(CLIENT_C);
    expect(loginRes.statusCode, "login must be unaffected by register's throttle").toBe(200);
  });
});
