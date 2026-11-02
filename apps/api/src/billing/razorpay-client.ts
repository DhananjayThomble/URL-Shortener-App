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
  };
}
