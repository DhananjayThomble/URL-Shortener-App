import {
  BadRequestException,
  Body,
  Controller,
  Get,
  Headers,
  HttpCode,
  Post,
  Req,
  UseGuards,
} from "@nestjs/common";
import { Throttle } from "@nestjs/throttler";
import type { FastifyRequest } from "fastify";
import { StartCheckoutInput, type CheckoutSession, type WorkspaceSubscription } from "@snapurl/contract";
import { zodBody } from "../common/zod.pipe.js";
import { Actor, Public, type RequestActor } from "../auth/auth.guard.js";
import { BillingService } from "./billing.service.js";
import { BillingEnabledGuard } from "./billing-enabled.guard.js";
import { PlanNotConfiguredError } from "./razorpay.provider.js";

/* The raw request bytes are stashed on the request by the application/json body
 *  parser in main.ts (#986). The webhook needs them unmodified because the HMAC
 *  is over the exact bytes received. */
declare module "fastify" {
  interface FastifyRequest {
    rawBody?: string;
  }
}

/* ============================================================
   #986 — the billing API surface (/api/v1/billing/*).

   Three routes: start a checkout, read the current subscription, and the
   Razorpay webhook. The webhook is @Public (Razorpay has no SnapURL session);
   it is secured by verifying X-Razorpay-Signature against the raw body, not by
   the auth guard. The other two are session routes.

   REACHABILITY: when billing is off (BILLING_PROVIDER=none) or half-configured,
   BillingEnabledGuard 404s EVERY route here BEFORE any body/query pipe runs —
   so the surface is unreachable (a 404, not a body-validation 400), exactly as
   the issue requires, and a self-hosted build behaves as if billing did not
   exist. The guard sits at the controller, so it covers the @Public webhook too.
   ============================================================ */
@Controller("billing")
@UseGuards(BillingEnabledGuard)
export class BillingController {
  constructor(private readonly billing: BillingService) {}

  @Post("checkout")
  async startCheckout(
    @Actor() actor: RequestActor,
    @Body(zodBody(StartCheckoutInput)) input: StartCheckoutInput,
  ): Promise<CheckoutSession> {
    try {
      return await this.billing.startCheckout(actor.workspaceId, actor.email, input.planKey, input.interval);
    } catch (err) {
      if (err instanceof PlanNotConfiguredError) {
        // A configuration gap for that plan, not a server fault.
        throw new BadRequestException(err.message);
      }
      throw err;
    }
  }

  @Get("subscription")
  async currentSubscription(@Actor() actor: RequestActor): Promise<WorkspaceSubscription> {
    return this.billing.currentSubscription(actor.workspaceId);
  }

  /**
   * Razorpay webhook. @Public: Razorpay authenticates by SIGNING the body, not
   * by a session. The signature is verified against the RAW bytes here; an
   * unsigned, mis-signed or replayed event changes nothing. Always answers 200
   * to a verified (processed OR duplicate) event so the provider stops
   * retrying, and 400 to one that does not verify.
   *
   * @Throttle: a dedicated, deliberate limit on this @Public endpoint. The
   * global throttler already covers it, but an unauthenticated POST that does
   * signature work deserves its own sane cap independent of the operator-tunable
   * global limit — 60/min per client IP is ample for Razorpay's real delivery
   * and retry cadence while bounding abuse of the public route. A declared
   * @Throttle is intentionally NOT operator-tunable (see ProxyAwareThrottlerGuard).
   */
  @Post("webhook")
  @Public()
  @Throttle({ default: { limit: 60, ttl: 60_000 } })
  @HttpCode(200)
  async webhook(
    @Req() req: FastifyRequest,
    @Headers("x-razorpay-signature") signature: string | undefined,
  ): Promise<{ received: true }> {
    const rawBody = req.rawBody ?? "";
    const event = this.billing.verifyWebhook(rawBody, signature);
    if (!event) {
      // Signature did not verify — reject, change nothing. A 400, not a 200,
      // so a genuinely misconfigured sender is visible rather than silently
      // swallowed, while a forged request learns nothing.
      throw new BadRequestException("Invalid webhook signature.");
    }

    await this.billing.handleWebhook(event);
    return { received: true };
  }
}
