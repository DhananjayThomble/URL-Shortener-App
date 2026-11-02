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
