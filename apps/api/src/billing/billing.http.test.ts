import "reflect-metadata";
import { createHmac } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import Fastify, { type FastifyInstance } from "fastify";
import { BadRequestException, NotFoundException } from "@nestjs/common";
import { BillingController } from "./billing.controller.js";
import type { BillingService } from "./billing.service.js";
import { RazorpayBillingProvider, type RazorpayClient } from "./razorpay.provider.js";
import { NoneBillingProvider } from "./none-billing.provider.js";
import { parsePlanIds } from "./billing-plans.js";
import type { RequestActor } from "../auth/auth.guard.js";
import type { FastifyRequest } from "fastify";

/* ============================================================
   #986 — the controller behaviour and the raw-body plumbing, proven directly.

   Two things a service test cannot show:

   1. The RAW request bytes reach the verifier UNMODIFIED. The HMAC is over the
      exact bytes received, so the second describe block registers the SAME
      application/json parser main.ts does (it stashes req.rawBody) into a real
      Fastify instance and asserts a correctly-signed body round-trips while a
      forged one does not — if the parser dropped the raw bytes, the HMAC over a
      re-serialised body would not match and the CORRECT signature would fail,
      so a green "signed → verified" IS the raw-body proof.

   2. With BILLING_PROVIDER=none the whole surface is UNREACHABLE: the
      controller's ensureEnabled() throws NotFound for every route.

   The controller is exercised by calling its methods directly (Nest DI does not
   emit constructor param metadata under the esbuild/vitest transform, so the
   module-bootstrap path is not used here). OBVIOUSLY FAKE fixture secrets only.
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

const ACTOR: RequestActor = {
  userId: "u1",
  workspaceId: "ws1",
  role: "owner",
  email: "owner@example.com",
  label: "owner@example.com",
};

/** A BillingService stand-in: the provider is real (so verifyWebhook is the real
 *  HMAC gate), DB writes are recorded instead of run. */
function stubService(provider: RazorpayBillingProvider | NoneBillingProvider) {
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
    }),
    startCheckout: async () => ({
      provider: "razorpay" as const,
      subscriptionId: "sub_fake",
      keyId: FAKE_KEY_ID,
      planKey: "pro" as const,
      interval: "monthly" as const,
    }),
  };
  return { svc: svc as unknown as BillingService, handled };
}

function razorpayProvider(): RazorpayBillingProvider {
  const fake: RazorpayClient = {
    createSubscription: async () => ({ id: "sub_fake" }),
    cancelSubscription: async () => {},
    refundPayment: async () => {},
  };
  return new RazorpayBillingProvider(
    { keyId: FAKE_KEY_ID, keySecret: FAKE_KEY_SECRET, webhookSecret: FAKE_WEBHOOK_SECRET, planIds: parsePlanIds("pro:monthly=plan_fake") },
    fake,
  );
}

/** A fake request carrying a raw body and the signature header, as the parser +
 *  @Headers would hand the controller. */
function reqWith(rawBody: string): FastifyRequest {
  return { rawBody } as unknown as FastifyRequest;
}

describe("#986 BillingController — billing ON (razorpay)", () => {
  it("a correctly-signed webhook is processed (200-path)", async () => {
    const { svc, handled } = stubService(razorpayProvider());
    const ctrl = new BillingController(svc);
    const result = await ctrl.webhook(reqWith(CHARGED), sign(CHARGED, FAKE_WEBHOOK_SECRET));
    expect(result).toEqual({ received: true });
    expect(handled.length).toBe(1);
  });

  it("a forged webhook throws 400 and never reaches handleWebhook", async () => {
    const { svc, handled } = stubService(razorpayProvider());
    const ctrl = new BillingController(svc);
    await expect(ctrl.webhook(reqWith(CHARGED), sign(CHARGED, "whsec_wrong_9999"))).rejects.toBeInstanceOf(
      BadRequestException,
    );
    expect(handled.length).toBe(0);
  });

  it("a webhook with no signature throws 400", async () => {
    const { svc } = stubService(razorpayProvider());
    const ctrl = new BillingController(svc);
    await expect(ctrl.webhook(reqWith(CHARGED), undefined)).rejects.toBeInstanceOf(BadRequestException);
  });

  it("checkout and subscription are reachable when billing is on", async () => {
    const { svc } = stubService(razorpayProvider());
    const ctrl = new BillingController(svc);
    await expect(ctrl.startCheckout(ACTOR, { planKey: "pro", interval: "monthly" })).resolves.toMatchObject({
      provider: "razorpay",
    });
    await expect(ctrl.currentSubscription(ACTOR)).resolves.toMatchObject({ planKey: "free" });
  });
});

describe("#986 BillingController — billing OFF (none) is unreachable", () => {
  it("every route throws NotFound", async () => {
    const { svc } = stubService(new NoneBillingProvider());
    const ctrl = new BillingController(svc);
    await expect(ctrl.startCheckout(ACTOR, { planKey: "pro", interval: "monthly" })).rejects.toBeInstanceOf(
      NotFoundException,
    );
    await expect(ctrl.currentSubscription(ACTOR)).rejects.toBeInstanceOf(NotFoundException);
    await expect(ctrl.webhook(reqWith(CHARGED), sign(CHARGED, FAKE_WEBHOOK_SECRET))).rejects.toBeInstanceOf(
      NotFoundException,
    );
  });
});

/* ── The raw-body parser, proven in a real Fastify instance (as #442's test
      does): a signed body round-trips through the parser and still verifies,
      which can only happen if req.rawBody is the exact bytes received. ── */
describe("#986 raw-body parser preserves the exact bytes the HMAC is over", () => {
  let fastify: FastifyInstance;
  const provider = razorpayProvider();

  beforeAll(async () => {
    fastify = Fastify();
    // The SAME parser main.ts registers.
    fastify.addContentTypeParser("application/json", { parseAs: "string" }, (req, body, done) => {
      const raw = body as string;
      (req as { rawBody?: string }).rawBody = raw === "" ? undefined : raw;
      if (raw === "") return done(null, undefined);
      try {
        done(null, JSON.parse(raw));
      } catch (err) {
        done(err as Error, undefined);
      }
    });
    // A route that verifies the webhook off the stashed raw body, like the
    // controller does.
    fastify.post("/billing/webhook", async (req, reply) => {
      const raw = (req as { rawBody?: string }).rawBody ?? "";
      const sig = req.headers["x-razorpay-signature"] as string | undefined;
      const event = provider.verifyWebhook(raw, sig);
      if (!event) return reply.status(400).send({ ok: false });
      return reply.status(200).send({ ok: true, eventId: event.eventId });
    });
    await fastify.ready();
  });

  afterAll(async () => {
    await fastify.close();
  });

  it("a correctly-signed body verifies after passing through the parser", async () => {
    const res = await fastify.inject({
      method: "POST",
      url: "/billing/webhook",
      headers: { "content-type": "application/json", "x-razorpay-signature": sign(CHARGED, FAKE_WEBHOOK_SECRET) },
      body: CHARGED,
    });
    expect(res.statusCode).toBe(200);
    expect(JSON.parse(res.body)).toMatchObject({ ok: true, eventId: "evt_http_1" });
  });

  it("a forged signature is rejected after passing through the parser", async () => {
    const res = await fastify.inject({
      method: "POST",
      url: "/billing/webhook",
      headers: { "content-type": "application/json", "x-razorpay-signature": sign(CHARGED, "whsec_wrong_9999") },
      body: CHARGED,
    });
    expect(res.statusCode).toBe(400);
  });

  it("a body re-serialised with different key order would NOT match (why raw bytes matter)", async () => {
    // Sign the canonical bytes, then deliver a semantically-equal but
    // byte-different body: the HMAC is over bytes, so it must be rejected. This
    // is exactly the failure a JSON.stringify(req.body) verifier would hit.
    const reordered = JSON.stringify({
      event: "subscription.charged",
      id: "evt_http_1",
      payload: { subscription: { entity: { current_end: 1_800_000_000, id: "sub_fake" } } },
    });
    const res = await fastify.inject({
      method: "POST",
      url: "/billing/webhook",
      headers: { "content-type": "application/json", "x-razorpay-signature": sign(CHARGED, FAKE_WEBHOOK_SECRET) },
      body: reordered,
    });
    expect(res.statusCode).toBe(400);
  });
});
