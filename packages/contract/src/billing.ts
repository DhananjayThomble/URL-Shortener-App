import { z } from "zod";

/* ============================================================
   #986 — billing core (epic #991), Razorpay in test mode.

   The wire shapes for paid plans. The whole surface is reachable only when the
   API runs with BILLING_PROVIDER=razorpay; with the default BILLING_PROVIDER=none
   nothing here is served (the API answers 404), so a self-hosted / open-source
   build behaves exactly as before. No card data touches SnapURL — checkout is
   handed to Razorpay Checkout, and a workspace's plan only ever moves from a
   webhook whose signature the API verified.

   Plans are referred to by KEY (starter / pro / team), never by a price or a
   provider id. Editable plans (#970) and admin-editable prices (#987) are later
   parts of the epic, so nothing here edits a price: the catalogue of keys is
   fixed and the money lives with the provider.
   ============================================================ */

/** The plan keys this build knows. `free` is the implicit default every
 *  workspace starts on and is never purchased, so it is NOT a checkout target —
 *  PAID_PLAN_KEYS is what a checkout may ask for. Referred to by key everywhere
 *  so this does not block on #970's editable plans. */
export const PLAN_KEYS = ["free", "starter", "pro", "team"] as const;
export type PlanKey = (typeof PLAN_KEYS)[number];

/** The plans a checkout can be started for — every key except the free default. */
export const PAID_PLAN_KEYS = ["starter", "pro", "team"] as const;
export type PaidPlanKey = (typeof PAID_PLAN_KEYS)[number];

/** Monthly or yearly. The provider holds a separate price per interval; the key
 *  plus the interval is enough to resolve which one to charge, so nothing here
 *  carries an amount. */
export const BILLING_INTERVALS = ["monthly", "yearly"] as const;
export type BillingInterval = (typeof BILLING_INTERVALS)[number];

/** The lifecycle of a subscription, mirroring the states Razorpay reports on a
 *  subscription so an incoming webhook maps onto one without translation loss.
 *  `active` and `trialing` are the paid states; everything else is a workspace
 *  that is not currently entitled to its paid plan. */
export const SUBSCRIPTION_STATUSES = [
  "created",
  "authenticated",
  "active",
  "trialing",
  "past_due",
  "halted",
  "cancelled",
  "completed",
  "expired",
] as const;
export type SubscriptionStatus = (typeof SUBSCRIPTION_STATUSES)[number];

/** Start a checkout for a paid plan + interval. The body names a plan by KEY,
 *  never a price or a provider id — the server resolves the configured provider
 *  price for that (key, interval) pair, so a client cannot name its own amount. */
export const StartCheckoutInput = z.object({
  planKey: z.enum(PAID_PLAN_KEYS),
  interval: z.enum(BILLING_INTERVALS),
});
export type StartCheckoutInput = z.infer<typeof StartCheckoutInput>;

/** What the browser needs to hand control to Razorpay Checkout. These are the
 *  values Checkout.js opens with — the public key id and the provider's
 *  subscription/order id — never a secret. The browser's later "payment
 *  succeeded" callback activates nothing; only the verified webhook does. */
export const CheckoutSession = z.object({
  /** The provider, so the client loads the right checkout SDK. */
  provider: z.literal("razorpay"),
  /** The Razorpay subscription id the checkout is opened against. */
  subscriptionId: z.string(),
  /** The PUBLIC key id (ships in the page that starts the flow — not a secret). */
  keyId: z.string(),
  /** Echoed back so the client can show which plan it is confirming. */
  planKey: z.enum(PAID_PLAN_KEYS),
  interval: z.enum(BILLING_INTERVALS),
});
export type CheckoutSession = z.infer<typeof CheckoutSession>;

/** The workspace's current subscription, as GET /billing/subscription returns
 *  it. `planKey` is `free` with a null `status` for a workspace that has never
 *  subscribed — the honest shape for "no paid plan", not an absent response. */
export const WorkspaceSubscription = z.object({
  planKey: z.enum(PLAN_KEYS),
  interval: z.enum(BILLING_INTERVALS).nullable(),
  status: z.enum(SUBSCRIPTION_STATUSES).nullable(),
  /** ISO-8601 end of the current paid period, or null when not subscribed. */
  currentPeriodEnd: z.string().nullable(),
  /** True once a cancellation is scheduled for the period end but the plan is
   *  still active until then. */
  cancelAtPeriodEnd: z.boolean(),
});
export type WorkspaceSubscription = z.infer<typeof WorkspaceSubscription>;
