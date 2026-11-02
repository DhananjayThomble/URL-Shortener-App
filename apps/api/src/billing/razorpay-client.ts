import Razorpay from "razorpay";
import type { RazorpayClient, RazorpayInvoiceEntity } from "./razorpay.provider.js";

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
      // #992 — offer_id applies a coupon; start_at (epoch seconds) defers the
      // first charge for a trial. Both are set only when present, so a plain
      // checkout body is unchanged from #986. The SDK typings lag these fields,
      // so the body is assembled as the REST shape and the SDK call is cast.
      const body: Record<string, unknown> = {
        plan_id: params.planId,
        total_count: params.totalCount,
        notes: params.notes,
        customer_notify: 1,
      };
      if (params.offerId) body.offer_id = params.offerId;
      if (params.startAt !== undefined) body.start_at = params.startAt;
      const sub = await (rzp.subscriptions as unknown as {
        create(b: Record<string, unknown>): Promise<{ id: string }>;
      }).create(body);
      return { id: sub.id };
    },

    async cancelSubscription(subscriptionId, cancelAtCycleEnd) {
      await rzp.subscriptions.cancel(subscriptionId, cancelAtCycleEnd);
    },

    async updateSubscription(subscriptionId, params) {
      // Razorpay's subscription update takes the new plan_id and a
      // schedule_change_at of "now" (prorate) or "cycle_end" (defer). The SDK's
      // typings lag the API here, so the call is shaped as the REST body.
      await (rzp.subscriptions as unknown as {
        update(id: string, body: Record<string, unknown>): Promise<unknown>;
      }).update(subscriptionId, {
        plan_id: params.planId,
        schedule_change_at: params.scheduleChangeAt,
      });
    },

    async listInvoices(subscriptionId) {
      const res = (await rzp.invoices.all({ subscription_id: subscriptionId })) as {
        items?: RazorpayInvoiceEntity[];
      };
      return res.items ?? [];
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
