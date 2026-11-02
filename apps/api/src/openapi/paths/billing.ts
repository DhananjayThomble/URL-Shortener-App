import { refs, route } from "../registry.js";

/* #986 — billing (epic #991). Reachable only when BILLING_PROVIDER=razorpay;
   with the default `none` every route 404s. The webhook is @Public — Razorpay
   authenticates by signing the body, not with a session token. */

route({
  method: "post",
  path: "/billing/checkout",
  tag: "Billing",
  summary: "Start a checkout for a plan + interval",
  body: refs.StartCheckoutInput,
  responses: {
    200: { description: "The checkout session to open Razorpay Checkout with", schema: refs.CheckoutSession },
    400: { description: "No provider plan configured for that plan key + interval" },
    404: { description: "Billing is disabled on this deployment" },
  },
});

route({
  method: "get",
  path: "/billing/subscription",
  tag: "Billing",
  summary: "The caller's workspace subscription",
  responses: {
    200: { description: "The current subscription (free shape when none)", schema: refs.WorkspaceSubscription },
    404: { description: "Billing is disabled on this deployment" },
  },
});

route({
  method: "get",
  path: "/billing/invoices",
  tag: "Billing",
  summary: "The workspace's Razorpay-generated invoices (owner only)",
  responses: {
    200: { description: "Invoices, newest first (empty when none)", schema: refs.BillingInvoiceList },
    403: { description: "Only the workspace owner can view billing" },
    404: { description: "Billing is disabled on this deployment" },
  },
});

route({
  method: "post",
  path: "/billing/cancel",
  tag: "Billing",
  summary: "Schedule the subscription to end (owner only)",
  body: refs.CancelSubscriptionInput,
  responses: {
    200: { description: "The subscription with the pending cancellation reflected", schema: refs.WorkspaceSubscription },
    400: { description: "No active subscription to cancel" },
    403: { description: "Only the workspace owner can change billing" },
    404: { description: "Billing is disabled on this deployment" },
  },
});

route({
  method: "post",
  path: "/billing/change",
  tag: "Billing",
  summary: "Change between paid plans — upgrade now, downgrade at cycle end (owner only)",
  body: refs.ChangePlanInput,
  responses: {
    200: { description: "The subscription; the plan moves on the verified webhook", schema: refs.WorkspaceSubscription },
    400: { description: "Unconfigured plan, the same plan, or no active subscription" },
    403: { description: "Only the workspace owner can change billing" },
    404: { description: "Billing is disabled on this deployment" },
  },
});

route({
  method: "post",
  path: "/billing/webhook",
  tag: "Billing",
  summary: "Razorpay webhook (signature-verified, idempotent)",
  public: true,
  responses: {
    200: { description: "Event verified and processed (or already processed)" },
    400: { description: "Signature did not verify — nothing changed" },
    404: { description: "Billing is disabled on this deployment" },
  },
});
