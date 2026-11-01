import {
  BadRequestException,
  Body,
  Controller,
  Get,
  Headers,
  HttpCode,
  NotFoundException,
  Post,
  Req,
} from "@nestjs/common";
import type { FastifyRequest } from "fastify";
import { StartCheckoutInput, type CheckoutSession, type WorkspaceSubscription } from "@snapurl/contract";
import { zodBody } from "../common/zod.pipe.js";
import { Actor, Public, type RequestActor } from "../auth/auth.guard.js";
import { BillingService } from "./billing.service.js";
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
   BillingService.enabled is false and EVERY route here answers 404 via
   ensureEnabled() — the surface is unreachable, exactly as the issue requires,
   and a self-hosted build behaves as if billing did not exist.
   ============================================================ */
@Controller("billing")
export class BillingController {
  constructor(private readonly billing: BillingService) {}

  /** 404 the whole surface when billing is off/half-configured. A 404 (not a
   *  403) because the honest answer is "this route does not exist here", which
   *  is what an open-source build without billing should look like. */
  private ensureEnabled(): void {
    if (!this.billing.enabled) {
      throw new NotFoundException("Not found.");
    }
  }

  @Post("checkout")
  async startCheckout(
    @Actor() actor: RequestActor,
    @Body(zodBody(StartCheckoutInput)) input: StartCheckoutInput,
  ): Promise<CheckoutSession> {
    this.ensureEnabled();
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
    this.ensureEnabled();
    return this.billing.currentSubscription(actor.workspaceId);
  }

  /**
   * Razorpay webhook. @Public: Razorpay authenticates by SIGNING the body, not
   * by a session. The signature is verified against the RAW bytes here; an
   * unsigned, mis-signed or replayed event changes nothing. Always answers 200
   * to a verified (processed OR duplicate) event so the provider stops
   * retrying, and 400 to one that does not verify.
   */
  @Post("webhook")
  @Public()
  @HttpCode(200)
  async webhook(
    @Req() req: FastifyRequest,
    @Headers("x-razorpay-signature") signature: string | undefined,
  ): Promise<{ received: true }> {
    this.ensureEnabled();

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
