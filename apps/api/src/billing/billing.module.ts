import { Module } from "@nestjs/common";
import { ENV, type Env } from "../config/env.js";
import { BillingController } from "./billing.controller.js";
import { BillingService } from "./billing.service.js";
import { BillingEnabledGuard } from "./billing-enabled.guard.js";
import { BILLING_PROVIDER, type BillingProvider } from "./billing-provider.js";
import { NoneBillingProvider } from "./none-billing.provider.js";
import { RazorpayBillingProvider } from "./razorpay.provider.js";
import { makeRazorpayClient } from "./razorpay-client.js";
import { parsePlanIds } from "./billing-plans.js";

/* ============================================================
   #986 — billing module (epic #991).

   The controller is ALWAYS mounted (so the route-inventory / OpenAPI / access
   -matrix guards see a stable surface), but the provider is selected by
   BILLING_PROVIDER and the controller 404s every route while the provider
   reports disabled. With the default BILLING_PROVIDER=none the NoneBillingProvider
   is wired, so the whole surface is unreachable and the app behaves exactly as
   before billing existed.

   The real Razorpay provider is only constructed when BILLING_PROVIDER=razorpay
   AND all three credentials are present; otherwise it falls back to the none
   provider so a half-configured deploy fails closed (routes 404) rather than
   throwing at a half-open route.
   ============================================================ */
@Module({
  controllers: [BillingController],
  providers: [
    BillingService,
    BillingEnabledGuard,
    {
      provide: BILLING_PROVIDER,
      inject: [ENV],
      useFactory: (env: Env): BillingProvider => {
        if (env.BILLING_PROVIDER === "razorpay" && env.RAZORPAY_KEY_ID && env.RAZORPAY_KEY_SECRET) {
          return new RazorpayBillingProvider(
            {
              keyId: env.RAZORPAY_KEY_ID,
              keySecret: env.RAZORPAY_KEY_SECRET,
              webhookSecret: env.RAZORPAY_WEBHOOK_SECRET,
              planIds: parsePlanIds(env.RAZORPAY_PLAN_IDS),
            },
            makeRazorpayClient(env.RAZORPAY_KEY_ID, env.RAZORPAY_KEY_SECRET),
          );
        }
        return new NoneBillingProvider();
      },
    },
  ],
  // #987 — export the resolved provider too, so PlansAdminService (admin module)
  // can push an edited price to it through the same seam, without re-resolving
  // the provider or reaching into billing internals.
  exports: [BillingService, BILLING_PROVIDER],
})
export class BillingModule {}
