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
  /** #992 — an optional coupon code to apply at checkout. The server validates
   *  it against the coupon's own rules (expiry, max redemptions, plan/interval
   *  restriction, paused) and records the redemption; the DISCOUNT is applied by
   *  the provider via the coupon's offer id. An absent or empty code is simply
   *  no coupon. Trimmed and length-capped to the coupon code shape. */
  couponCode: z.string().trim().min(1).max(40).optional(),
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
  /** #987 — the LIVE price the checkout is being confirmed at, read from the
   *  editable plan catalogue at checkout time (not baked in at deploy), so an
   *  admin's price change is reflected without a redeploy. Minor units (paise/
   *  cents); null when the plan has no price set for this (interval, currency).
   *  The server still resolves the provider plan id independently — this is for
   *  the confirmation screen, never a client-named amount. */
  amountMinor: z.number().int().min(0).nullable(),
  currency: z.string(),
  /** #992 — the coupon that was applied at checkout, or null when none. The
   *  `code` is echoed for the confirmation screen and `discountMinor` is the
   *  preview discount off `amountMinor` (the provider applies the real discount
   *  via the coupon's offer). Null when no coupon, or when the applied coupon
   *  has no provider offer (nothing is discounted at the provider then). */
  coupon: z
    .object({
      code: z.string(),
      discountMinor: z.number().int().min(0),
    })
    .nullable()
    .default(null),
  /** #992 — when this checkout starts a free trial, the ISO instant the trial
   *  ends (the first charge date), else null. Entitlement during the trial is
   *  the provider's `trialing` status on the verified webhook, never a local
   *  grant — this is for the confirmation screen only. */
  trialEndsAt: z.string().datetime().nullable().default(null),
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
  /** #989 — the in-app notice a client renders. Non-null only when the
   *  subscription needs the owner's attention: a failed payment has opened a
   *  grace window the plan survives until, or a scheduled cancellation will end
   *  the plan at the period end. Null when nothing is wrong, so a client shows a
   *  banner iff this is present. The plan stays entitled for the whole grace
   *  window; it lapses to free only once `graceEndsAt` passes. */
  notice: z
    .object({
      /** Which situation the notice is about. */
      kind: z.enum(["payment_failed", "cancellation_scheduled"]),
      /** ISO-8601 instant the plan reverts to free if nothing changes — the end
       *  of the grace window for a failed payment, or the period end for a
       *  scheduled cancellation. */
      revertsAt: z.string().nullable(),
    })
    .nullable(),
  /** #988 — a REQUESTED paid-plan change the owner made that the provider has
   *  not confirmed yet. Non-null between changePlan and the verified webhook
   *  that applies it; the current plan (planKey above) is still what the
   *  workspace is entitled to until then. The UI shows "pending change to X".
   *  Null when no change is in flight. */
  pendingChange: z
    .object({
      planKey: z.enum(PAID_PLAN_KEYS),
      interval: z.enum(BILLING_INTERVALS),
    })
    .nullable(),
});
export type WorkspaceSubscription = z.infer<typeof WorkspaceSubscription>;

/* ============================================================
   #988 — the owner-facing billing surface (epic #991).

   The workspace owner manages their own plan in the app: an upgrade flow, the
   Settings → Billing page (plan, renewal, status, invoices, cancel at period
   end), and a change between paid plans. Everything here is still reachable
   only when BILLING_PROVIDER=razorpay — a self-hosted / `none` build 404s the
   lot, exactly as #986.

   The money still lives with Razorpay. An invoice is a RECORD of a charge the
   provider raised: the amount, the currency and the provider's own downloadable
   PDF link — SnapURL never generates a PDF and never holds a card number. And a
   plan change still NEVER moves the plan on its own: changePlan asks the
   provider, and the workspace's entitlement only moves when the resulting
   webhook arrives verified (#986's invariant).
   ============================================================ */

/** The paid states a Razorpay invoice sits in. `paid` is the only one that
 *  counts as money received; the others are shown honestly (an owner should see
 *  a failed charge, not a gap). */
export const INVOICE_STATUSES = ["paid", "issued", "partially_paid", "cancelled", "expired"] as const;
export type InvoiceStatus = (typeof INVOICE_STATUSES)[number];

/** One Razorpay-generated invoice, as GET /billing/invoices returns it. The
 *  amount is in the currency's MINOR unit (paise / cents) exactly as the
 *  provider reports it — the UI formats it, nothing here rounds. `pdfUrl` is the
 *  provider's own short-lived download link, or null when the provider has not
 *  (yet) attached one; it is NEVER a SnapURL-hosted document. No card data, no
 *  customer PII beyond what an invoice line already is. */
export const BillingInvoice = z.object({
  /** The provider's invoice id. */
  id: z.string(),
  /** The human invoice number the provider assigned, or null before one exists. */
  number: z.string().nullable(),
  status: z.enum(INVOICE_STATUSES),
  /** Amount in the currency's minor unit (e.g. paise), as the provider reports. */
  amount: z.number().int().nonnegative(),
  /** ISO-4217 currency code, upper-case. */
  currency: z.string().length(3),
  /** ISO-8601 issue time. */
  createdAt: z.string(),
  /** The provider's downloadable PDF link, or null when none is attached. */
  pdfUrl: z.string().url().nullable(),
});
export type BillingInvoice = z.infer<typeof BillingInvoice>;

/** GET /billing/invoices — the workspace's invoices, newest first. */
export const BillingInvoiceList = z.array(BillingInvoice);
export type BillingInvoiceList = z.infer<typeof BillingInvoiceList>;

/** Change the workspace between paid plans. The body names a plan by KEY, never
 *  a price. `when` decides the timing: an UPGRADE takes effect `now` (prorated
 *  by the provider, charged on the next cycle), a DOWNGRADE is `at_cycle_end` so
 *  the owner keeps what they paid for until the period ends. The controller
 *  derives `when` itself from the plan ranking — the client cannot ask for a
 *  downgrade-now that would refund-churn, nor an upgrade deferred past a renewal
 *  — but it is on the wire so the intent is explicit and testable. */
export const ChangePlanInput = z.object({
  planKey: z.enum(PAID_PLAN_KEYS),
  interval: z.enum(BILLING_INTERVALS),
});
export type ChangePlanInput = z.infer<typeof ChangePlanInput>;

/** POST /billing/cancel — schedule the subscription to end. `atPeriodEnd` true
 *  (the default the UI sends) keeps the plan live until the paid period ends;
 *  false cancels immediately. Either way the plan only actually moves when the
 *  provider's cancellation webhook arrives verified. */
export const CancelSubscriptionInput = z.object({
  atPeriodEnd: z.boolean().default(true),
});
export type CancelSubscriptionInput = z.infer<typeof CancelSubscriptionInput>;
