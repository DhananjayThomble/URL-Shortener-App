import {
  BadRequestException,
  Body,
  Controller,
  ForbiddenException,
  Get,
  Headers,
  HttpCode,
  Post,
  Put,
  Req,
  UseGuards,
} from "@nestjs/common";
import { Throttle } from "@nestjs/throttler";
import type { FastifyRequest } from "fastify";
import {
  BillingDetailsInput,
  CancelSubscriptionInput,
  ChangePlanInput,
  StartCheckoutInput,
  type BillingDetails,
  type BillingInvoice,
  type CheckoutSession,
  type WorkspaceSubscription,
} from "@snapurl/contract";
import { zodBody } from "../common/zod.pipe.js";
import { Actor, Public, type RequestActor } from "../auth/auth.guard.js";
import { BillingService, NoActiveSubscriptionError, SamePlanError } from "./billing.service.js";
import { BillingDetailsService } from "./billing-details.service.js";
import { BillingEnabledGuard } from "./billing-enabled.guard.js";
import { PlanNotConfiguredError } from "./razorpay.provider.js";
import { rethrowIfProviderError } from "./billing-provider-error.http.js";

/* #988 — billing is the workspace OWNER's to manage. Enforced here, in the
 *  handler, NOT with @Roles("owner"): the global AuthGuard evaluates @Roles
 *  BEFORE the controller-scoped BillingEnabledGuard runs, so an owner-only
 *  @Roles would answer a non-owner 403 even when billing is OFF — leaking that
 *  the route exists on a `none` build, where the honest answer is 404. Asserting
 *  the role inside the handler runs AFTER BillingEnabledGuard, so billing-off is
 *  404 for every principal (unreachable) and the owner-only 403 only applies
 *  once billing is on. */
function assertOwner(actor: RequestActor): void {
  if (actor.role !== "owner") {
    throw new ForbiddenException("Only the workspace owner can manage billing.");
  }
}

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
  constructor(
    private readonly billing: BillingService,
    private readonly billingDetails: BillingDetailsService,
  ) {}

  /**
   * #992 §5 — the workspace's billing details (company, tax id/GSTIN, address,
   * billing email). Owner-only read; an all-null record when none set yet.
   */
  @Get("details")
  async getDetails(@Actor() actor: RequestActor): Promise<BillingDetails> {
    assertOwner(actor);
    return this.billingDetails.get(actor.workspaceId);
  }

  /**
   * #992 §5 — set the workspace's billing details. Owner-only. A partial body
   * updates only the fields given; an explicit null clears a field. The details
   * are attached to the provider's customer best-effort so its invoices carry
   * them — a provider failure never loses the owner's input.
   */
  @Put("details")
  async setDetails(
    @Actor() actor: RequestActor,
    @Body(zodBody(BillingDetailsInput)) input: BillingDetailsInput,
  ): Promise<BillingDetails> {
    assertOwner(actor);
    return this.billingDetails.set(actor.workspaceId, input);
  }

  @Post("checkout")
  async startCheckout(
    @Actor() actor: RequestActor,
    @Body(zodBody(StartCheckoutInput)) input: StartCheckoutInput,
  ): Promise<CheckoutSession> {
    assertOwner(actor);
    try {
      return await this.billing.startCheckout(
        actor.workspaceId,
        actor.email,
        input.planKey,
        input.interval,
        input.couponCode,
      );
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
    assertOwner(actor);
    return this.billing.currentSubscription(actor.workspaceId);
  }

  /**
   * #988 — the workspace's Razorpay-generated invoices, newest first. The
   * amounts and the downloadable PDF links come straight from the provider;
   * SnapURL stores no invoice document and no card data.
   */
  @Get("invoices")
  async invoices(@Actor() actor: RequestActor): Promise<BillingInvoice[]> {
    assertOwner(actor);
    return this.billing.listInvoices(actor.workspaceId);
  }

  /**
   * #988 — schedule the workspace's subscription to end. The plan does NOT move
   * here: the provider's cancellation webhook, verified, is what lapses the
   * workspace back to free. A 400 when there is no active subscription to cancel.
   */
  @Post("cancel")
  async cancel(
    @Actor() actor: RequestActor,
    @Body(zodBody(CancelSubscriptionInput)) input: CancelSubscriptionInput,
  ): Promise<WorkspaceSubscription> {
    assertOwner(actor);
    try {
      return await this.billing.cancelSubscription(actor.workspaceId, input.atPeriodEnd, {
        reason: input.reason ?? null,
        comment: input.comment ?? null,
      });
    } catch (err) {
      // #1023 — a provider failure cancelling at Razorpay becomes a 409/422
      // (rejected, e.g. "can't cancel when not Active") or a 503 (unavailable),
      // never a generic 500. The local cancelAtPeriodEnd is NOT written: the
      // service asks the provider first and only writes on success.
      rethrowIfProviderError(err, {
        rejectedMessage:
          "This subscription can't be cancelled right now because of its current state at the payment provider.",
      });
      if (err instanceof NoActiveSubscriptionError) throw new BadRequestException(err.message);
      throw err;
    }
  }

  /**
   * #988 — change the workspace between paid plans. An upgrade applies now
   * (prorated); a downgrade defers to the cycle end. The server derives the
   * timing from the plan ranking. The plan moves only on the verified webhook
   * that follows. 400 on an unconfigured plan, the same plan, or no active sub.
   */
  @Post("change")
  async change(
    @Actor() actor: RequestActor,
    @Body(zodBody(ChangePlanInput)) input: ChangePlanInput,
  ): Promise<WorkspaceSubscription> {
    assertOwner(actor);
    try {
      return await this.billing.changePlan(actor.workspaceId, input.planKey, input.interval);
    } catch (err) {
      // #1023 — the issue's exact repro: a Razorpay 4xx changing the plan on a
      // not-yet-Active subscription becomes a 409 (rejected) with an honest
      // message + stable reason, and a provider outage a 503 — never a 500
      // "try again". The pending plan change is NOT recorded: changePlan asks
      // the provider first and writes pendingPlanKey only on success.
      rethrowIfProviderError(err, {
        rejectedMessage:
          "This subscription can't be changed right now because its first payment isn't complete.",
      });
      if (
        err instanceof PlanNotConfiguredError ||
        err instanceof SamePlanError ||
        err instanceof NoActiveSubscriptionError
      ) {
        throw new BadRequestException(err.message);
      }
      throw err;
    }
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
