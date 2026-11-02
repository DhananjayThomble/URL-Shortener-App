import Razorpay from "razorpay";
import type { RazorpayClient } from "./razorpay.provider.js";

/* ============================================================
   #986 — the real RazorpayClient, wrapping the official `razorpay` npm package.

   This is the only file that imports the SDK. Everything else depends on the
   RazorpayClient interface, so the provider's logic and the webhook verifier
   are tested with a fake and CI never needs a real key or a network. The SDK is
   constructed with the key id + key SECRET; the secret is held only here and
   never returned or logged.
   ============================================================ */

export function makeRazorpayClient(keyId: string, keySecret: string): RazorpayClient {
  const rzp = new Razorpay({ key_id: keyId, key_secret: keySecret });

  return {
    async createSubscription(params) {
      const sub = await rzp.subscriptions.create({
        plan_id: params.planId,
        total_count: params.totalCount,
        notes: params.notes,
        customer_notify: 1,
      });
      return { id: sub.id };
    },

    async cancelSubscription(subscriptionId, cancelAtCycleEnd) {
      await rzp.subscriptions.cancel(subscriptionId, cancelAtCycleEnd);
    },

    async refundPayment(paymentId) {
      await rzp.payments.refund(paymentId, {});
    },

    // #987 — create a Razorpay plan for an edited price. Razorpay plans are
    // immutable, so an edit creates a new plan the next checkout uses.
    async createPlan(params) {
      const plan = await rzp.plans.create({
        period: params.period,
        interval: params.interval,
        item: {
          name: params.name,
          amount: params.amount,
          currency: params.currency,
        },
        notes: params.notes,
      });
      return { id: plan.id };
    },
  };
}
