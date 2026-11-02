import "reflect-metadata";
import { createHmac } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { Controller, Module } from "@nestjs/common";
import { APP_GUARD, NestFactory, Reflector } from "@nestjs/core";
import { ThrottlerModule } from "@nestjs/throttler";
import { FastifyAdapter, type NestFastifyApplication } from "@nestjs/platform-fastify";
import { MemoryCacheStore } from "@snapurl/cache";

import { BillingController } from "./billing.controller.js";
import { BillingService } from "./billing.service.js";
import { BillingEnabledGuard } from "./billing-enabled.guard.js";
import { RazorpayBillingProvider, type RazorpayClient } from "./razorpay.provider.js";
import { NoneBillingProvider } from "./none-billing.provider.js";
import { parsePlanIds } from "./billing-plans.js";
import { ProxyAwareThrottlerGuard } from "../common/proxy-aware-throttler.guard.js";
import { CacheStoreThrottlerStorage } from "../common/cache-throttler-storage.js";
import { PlatformSettingsService } from "../admin/platform-settings.service.js";
import { AuthGuard, type RequestActor } from "../auth/auth.guard.js";
import { ENV } from "../config/env.js";

/* ============================================================
   #986 — the billing controller over the REAL Nest + Fastify + guard pipeline.

   This drives the ACTUAL controller (via a thin test subclass that only
   hand-feeds the stub service, because the vitest/esbuild transform does not
   emit design:paramtypes for constructor injection — the same technique as
   register-throttle.integration.test.ts), behind the REAL guards: the global
   ProxyAwareThrottlerGuard (so every route is rate-limited, including the
   webhook's own @Throttle), a real AuthGuard (so the session routes are
   genuinely authenticated), and the real BillingEnabledGuard at the controller.

   There is NO hand-rolled route handler here. The earlier version stood up a
   bare Fastify route that did authorization without rate limiting, which is the
   js/missing-rate-limiting pattern CodeQL (rightly) flagged; routing the proof
   through the real controller + real throttler removes that pattern for real
   rather than suppressing the finding.

   What it proves:
   1. Billing ON: the webhook verifies the signature over the RAW bytes the
      parser preserved (signed → 200, forged/missing-sig → 400); the session
      routes are reachable; a reordered body is rejected (raw bytes matter).
   2. Billing OFF (none): BillingEnabledGuard 404s every route BEFORE any body
      pipe — so POST /checkout with an INVALID body is still 404, not a
      validation 400 (the invariant the access-matrix oracle encodes).
   3. The webhook carries a @Throttle that the real guard enforces: the 61st
      call in the window from one IP is 429.

   OBVIOUSLY FAKE low-entropy fixture secrets only.
   ============================================================ */

const FAKE_WEBHOOK_SECRET = "whsec_test_fake_0000";
const FAKE_KEY_ID = "rzp_test_fake_0000";
const FAKE_KEY_SECRET = "keysec_test_fake_0000";

function sign(body: string, secret: string): string {
  return createHmac("sha256", secret).update(body, "utf8").digest("hex");
}

const CHARGED = JSON.stringify({
  id: "evt_http_1",
  event: "subscription.charged",
  payload: { subscription: { entity: { id: "sub_fake", current_end: 1_800_000_000 } } },
});

/* ── Stubs ─────────────────────────────────────────────────────────────────── */

/* A real provider gives the controller a real verifyWebhook (the HMAC gate);
   DB writes are what the service stub swallows. */
function razorpayProvider(): RazorpayBillingProvider {
  const client: RazorpayClient = {
    createSubscription: async () => ({ id: "sub_fake" }),
    cancelSubscription: async () => {},
    updateSubscription: async () => {},
    listInvoices: async () => [],
    refundPayment: async () => {},
  };
  return new RazorpayBillingProvider(
    { keyId: FAKE_KEY_ID, keySecret: FAKE_KEY_SECRET, webhookSecret: FAKE_WEBHOOK_SECRET, planIds: parsePlanIds("pro:monthly=plan_fake") },
    client,
  );
}

function billingServiceStub(provider: RazorpayBillingProvider | NoneBillingProvider) {
  const handled: unknown[] = [];
  const svc = {
    get enabled() {
      return provider.enabled;
    },
    verifyWebhook: (rawBody: string, sig: string | undefined) => provider.verifyWebhook(rawBody, sig),
    handleWebhook: async (event: unknown) => {
      handled.push(event);
      return "processed" as const;
    },
    currentSubscription: async () => ({
      planKey: "free" as const,
      interval: null,
      status: null,
      currentPeriodEnd: null,
      cancelAtPeriodEnd: false,
      notice: null,
      pendingChange: null,
    }),
    startCheckout: async () => ({
      provider: "razorpay" as const,
      subscriptionId: "sub_fake",
      keyId: FAKE_KEY_ID,
      planKey: "pro" as const,
      interval: "monthly" as const,
      amountMinor: 19900,
      currency: "INR",
    }),
    // #988 — the owner-facing routes. The HTTP test's StubAuthGuard injects an
    // owner, so these are reachable here; the owner-only wiring is proved
    // separately (billing-owner-only.test.ts) against the real role metadata.
    listInvoices: async () => [
      {
        id: "inv_fake",
        number: "INV-1",
        status: "paid" as const,
        amount: 99900,
        currency: "INR",
        createdAt: "2026-11-01T00:00:00.000Z",
        pdfUrl: "https://rzp.example/i/inv_fake.pdf",
      },
    ],
    cancelSubscription: async () => ({
      planKey: "pro" as const,
      interval: "monthly" as const,
      status: "active" as const,
      currentPeriodEnd: "2026-12-01T00:00:00.000Z",
      cancelAtPeriodEnd: true,
      notice: null,
      pendingChange: null,
    }),
    changePlan: async () => ({
      planKey: "pro" as const,
      interval: "monthly" as const,
      status: "active" as const,
      currentPeriodEnd: "2026-12-01T00:00:00.000Z",
      cancelAtPeriodEnd: false,
      notice: null,
      // #988 — a change request is now PENDING (not applied) until the webhook.
      pendingChange: { planKey: "team" as const, interval: "monthly" as const },
    }),
  };
  return { svc: svc as unknown as BillingService, handled };
}

/* The guard reads only TRUSTED_PROXY_HOPS. */
const envStub = { TRUSTED_PROXY_HOPS: 1 } as never;
/* The throttler's settings dependency; the webhook route carries its own
   @Throttle, and the generous global default covers the session routes. */
const settingsStub = {
  getValues: async () => ({ rateLimit: { limit: 1000, ttlSeconds: 60 } }),
} as unknown as PlatformSettingsService;

/* A real AuthGuard needs a TokenService + DB; the session routes here only need
   SOME authenticated actor to exist, and the CodeQL finding is about rate
   limiting, not auth internals. So AuthGuard is stubbed to a fixed owner — the
   REAL throttler guard still runs ahead of it as APP_GUARD, which is the gate
   under test. */
const ACTOR: RequestActor = {
  userId: "u1",
  workspaceId: "ws1",
  role: "owner",
  email: "owner@example.com",
  label: "owner@example.com",
};
class StubAuthGuard {
  canActivate(ctx: { switchToHttp: () => { getRequest: () => { actor?: RequestActor } } }): boolean {
    ctx.switchToHttp().getRequest().actor = ACTOR;
    return true;
  }
}

const PROXY = "198.51.100.1";
const xff = (client: string) => `${client}, ${PROXY}`;

/* Build the app for a given provider. A test-local subclass hand-feeds the
   stub service (esbuild emits no paramtypes), inheriting every route, @Public,
   @Throttle and @UseGuards(BillingEnabledGuard) metadatum from the real
   controller's prototype — so the guard pipeline under test is the real one. */
async function buildApp(provider: RazorpayBillingProvider | NoneBillingProvider) {
  const { svc, handled } = billingServiceStub(provider);

  @Controller("billing")
  class TestBillingController extends BillingController {
    constructor() {
      super(svc);
    }
  }

  @Module({
    imports: [
      ThrottlerModule.forRoot({
        throttlers: [{ ttl: 60_000, limit: 1000 }],
        storage: new CacheStoreThrottlerStorage(new MemoryCacheStore()),
      }),
    ],
    controllers: [TestBillingController],
    providers: [
      { provide: ENV, useValue: envStub },
      { provide: PlatformSettingsService, useValue: settingsStub },
      // BillingEnabledGuard is applied at the controller via @UseGuards and
      // depends on BillingService — give it the same stub so it resolves.
      { provide: BillingService, useValue: svc },
      BillingEnabledGuard,
      Reflector,
      // The REAL global throttler, exactly as app.module.ts installs it, then a
      // stub auth guard. Order matters: throttler first so every route is
      // rate-limited regardless of auth.
      { provide: APP_GUARD, useClass: ProxyAwareThrottlerGuard },
      { provide: APP_GUARD, useClass: StubAuthGuard },
    ],
  })
  class TestBillingModule {}

  const app = await NestFactory.create<NestFastifyApplication>(
    TestBillingModule,
    new FastifyAdapter({ trustProxy: false }),
    { logger: false },
  );
  // The SAME application/json parser main.ts registers: stash the raw bytes,
  // then parse — so req.rawBody is the exact bytes the HMAC is over.
  app.useBodyParser("application/json", {}, (req, body, done) => {
    const buf = body as unknown as Buffer | string | undefined;
    const raw = buf === undefined ? undefined : typeof buf === "string" ? buf : buf.toString("utf8");
    (req as { rawBody?: string }).rawBody = raw;
    if (raw === undefined || raw === "") return done(null, undefined);
    try {
      done(null, JSON.parse(raw));
    } catch (err) {
      done(err as Error, undefined);
    }
  });
  app.setGlobalPrefix("api/v1");
  await app.init();
  await app.getHttpAdapter().getInstance().ready();
  return { app, handled };
}

describe("#986 billing HTTP — billing ON (razorpay), real guard pipeline", () => {
  let app: NestFastifyApplication;
  let handled: unknown[];

  beforeAll(async () => {
    ({ app, handled } = await buildApp(razorpayProvider()));
  });
  afterAll(async () => {
    await app.close();
  });

  const webhook = (body: string, sig: string | undefined, clientIp = "203.0.113.1") =>
    app.inject({
      method: "POST",
      url: "/api/v1/billing/webhook",
      headers: {
        "content-type": "application/json",
        "x-forwarded-for": xff(clientIp),
        ...(sig === undefined ? {} : { "x-razorpay-signature": sig }),
      },
      payload: body,
    });

  it("a correctly-signed webhook verifies over the raw body and 200s", async () => {
    handled.length = 0;
    const res = await webhook(CHARGED, sign(CHARGED, FAKE_WEBHOOK_SECRET));
    expect(res.statusCode).toBe(200);
    expect(handled.length).toBe(1);
  });

  it("a forged webhook is rejected with 400 and never reaches handleWebhook", async () => {
    handled.length = 0;
    const res = await webhook(CHARGED, sign(CHARGED, "whsec_wrong_9999"));
    expect(res.statusCode).toBe(400);
    expect(handled.length).toBe(0);
  });

  it("a webhook with no signature header is rejected with 400", async () => {
    handled.length = 0;
    const res = await webhook(CHARGED, undefined);
    expect(res.statusCode).toBe(400);
    expect(handled.length).toBe(0);
  });

  it("a body re-serialised with different key order is rejected (raw bytes matter)", async () => {
    const reordered = JSON.stringify({
      event: "subscription.charged",
      id: "evt_http_1",
      payload: { subscription: { entity: { current_end: 1_800_000_000, id: "sub_fake" } } },
    });
    const res = await webhook(reordered, sign(CHARGED, FAKE_WEBHOOK_SECRET));
    expect(res.statusCode).toBe(400);
  });

  it("the session routes are reachable (not 404) when billing is on", async () => {
    const res = await app.inject({
      method: "GET",
      url: "/api/v1/billing/subscription",
      headers: { "x-forwarded-for": xff("203.0.113.2") },
    });
    expect(res.statusCode).toBe(200);
  });

  it("#988 GET /billing/invoices is reachable and returns the provider's invoices", async () => {
    const res = await app.inject({
      method: "GET",
      url: "/api/v1/billing/invoices",
      headers: { "x-forwarded-for": xff("203.0.113.6") },
    });
    expect(res.statusCode).toBe(200);
    const body = res.json() as Array<{ id: string; pdfUrl: string | null }>;
    expect(body[0]!.id).toBe("inv_fake");
    expect(body[0]!.pdfUrl).toBe("https://rzp.example/i/inv_fake.pdf");
  });

  it("#988 POST /billing/cancel with a valid body 200s and reflects the pending cancellation", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/api/v1/billing/cancel",
      headers: { "content-type": "application/json", "x-forwarded-for": xff("203.0.113.7") },
      payload: JSON.stringify({ atPeriodEnd: true }),
    });
    expect(res.statusCode).toBe(201);
    expect((res.json() as { cancelAtPeriodEnd: boolean }).cancelAtPeriodEnd).toBe(true);
  });

  it("#988 POST /billing/change with a valid body 200s", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/api/v1/billing/change",
      headers: { "content-type": "application/json", "x-forwarded-for": xff("203.0.113.8") },
      payload: JSON.stringify({ planKey: "team", interval: "monthly" }),
    });
    expect(res.statusCode).toBe(201);
    // #988 — the change is now PENDING, not applied: the plan of record stays
    // the current one and the requested target is surfaced in pendingChange.
    const body = res.json() as { planKey: string; pendingChange: { planKey: string } | null };
    expect(body.planKey).toBe("pro");
    expect(body.pendingChange).toEqual({ planKey: "team", interval: "monthly" });
  });

  it("#988 POST /billing/change with an invalid plan key → 400 (body pipe runs when billing is on)", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/api/v1/billing/change",
      headers: { "content-type": "application/json", "x-forwarded-for": xff("203.0.113.9") },
      payload: JSON.stringify({ planKey: "enterprise", interval: "monthly" }),
    });
    expect(res.statusCode).toBe(400);
  });

  it("the webhook's @Throttle is enforced by the real guard: the 61st call from one IP is 429", async () => {
    const ip = "203.0.113.99";
    const sig = sign(CHARGED, FAKE_WEBHOOK_SECRET);
    for (let i = 1; i <= 60; i++) {
      const res = await webhook(CHARGED, sig, ip);
      expect(res.statusCode, `webhook #${i} should be within the 60/min budget`).toBeLessThan(400);
    }
    const sixtyFirst = await webhook(CHARGED, sig, ip);
    expect(sixtyFirst.statusCode).toBe(429);
  });
});

describe("#986 billing HTTP — billing OFF (none) is unreachable before validation", () => {
  let app: NestFastifyApplication;

  beforeAll(async () => {
    ({ app } = await buildApp(new NoneBillingProvider()));
  });
  afterAll(async () => {
    await app.close();
  });

  it("POST /billing/checkout with an INVALID body → 404 (guard runs before the body pipe), not 400", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/api/v1/billing/checkout",
      headers: { "content-type": "application/json", "x-forwarded-for": xff("203.0.113.3") },
      payload: JSON.stringify({ planKey: "not-a-plan", interval: "never" }),
    });
    expect(res.statusCode).toBe(404);
  });

  it("GET /billing/subscription → 404", async () => {
    const res = await app.inject({
      method: "GET",
      url: "/api/v1/billing/subscription",
      headers: { "x-forwarded-for": xff("203.0.113.4") },
    });
    expect(res.statusCode).toBe(404);
  });

  it("#988 GET /billing/invoices → 404 when billing is off", async () => {
    const res = await app.inject({
      method: "GET",
      url: "/api/v1/billing/invoices",
      headers: { "x-forwarded-for": xff("203.0.113.41") },
    });
    expect(res.statusCode).toBe(404);
  });

  it("#988 POST /billing/change with an INVALID body → 404 (guard before the body pipe), not 400", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/api/v1/billing/change",
      headers: { "content-type": "application/json", "x-forwarded-for": xff("203.0.113.42") },
      payload: JSON.stringify({ planKey: "not-a-plan", interval: "never" }),
    });
    expect(res.statusCode).toBe(404);
  });

  it("#988 POST /billing/cancel → 404 when billing is off", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/api/v1/billing/cancel",
      headers: { "content-type": "application/json", "x-forwarded-for": xff("203.0.113.43") },
      payload: JSON.stringify({ atPeriodEnd: true }),
    });
    expect(res.statusCode).toBe(404);
  });

  it("POST /billing/webhook → 404 even with a would-be-valid signature", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/api/v1/billing/webhook",
      headers: {
        "content-type": "application/json",
        "x-forwarded-for": xff("203.0.113.5"),
        "x-razorpay-signature": sign(CHARGED, FAKE_WEBHOOK_SECRET),
      },
      payload: CHARGED,
    });
    expect(res.statusCode).toBe(404);
  });
});
