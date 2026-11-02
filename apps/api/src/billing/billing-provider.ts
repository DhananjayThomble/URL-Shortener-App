import type { BillingInterval, PaidPlanKey, SubscriptionStatus } from "@snapurl/contract";

/* ============================================================
   #986 — the billing provider seam.

   One interface, two implementations: RazorpayBillingProvider (the real one,
   test mode) and NoneBillingProvider (the default). The core — the controller,
   the service, the webhook handler — depends only on this interface, so adding
   a Stripe adapter later is a new class here and nothing else. Shaped from the
   issue's scope list: create a checkout/subscription, cancel, refund, verify a
   webhook.

   Nothing in this interface returns or accepts a secret. verifyWebhook takes
   the RAW request bytes and the signature header and answers a boolean; the key
   secret lives inside the implementation, resolved from config.
   ============================================================ */

/** The provider's identifier, as it appears on the wire and in stored rows. */
export type BillingProviderName = "razorpay" | "none";

/** What a started checkout hands back to the browser. No secret here — just the
 *  public key id and the provider subscription id Checkout.js opens against. */
export interface CheckoutResult {
  subscriptionId: string;
  /** The PUBLIC key id (ships in the page). */
  keyId: string;
  /** #992 — when the checkout started a trial, the instant the trial ends (the
   *  provider's first-charge date), else null. The provider decides this from
   *  the trial days passed in; SnapURL records it on the row and echoes it for
   *  the confirmation screen, but entitlement still comes from the verified
   *  `trialing` webhook, never from this value. */
  trialEndsAt?: Date | null;
}

/* ============================================================
   #988 — invoices.

   An invoice is the provider's RECORD of a charge: the amount it raised, the
   currency, and its own downloadable PDF link. SnapURL never generates a PDF
   and never holds a card number — it lists what the provider already has. The
   provider shape below carries only those facts; the controller/service maps it
   onto the contract's BillingInvoice unchanged.
   ============================================================ */

/** One invoice as the provider reports it, before it is mapped to the wire
 *  shape. `amount` is the currency's minor unit (paise / cents), untouched. */
export interface ProviderInvoice {
  id: string;
  number: string | null;
  /** The provider's invoice status, already normalised to the contract set. */
  status: "paid" | "issued" | "partially_paid" | "cancelled" | "expired";
  amount: number;
  /** ISO-4217 code, upper-case. */
  currency: string;
  /** Epoch seconds the provider issued the invoice at. */
  issuedAt: number;
  /** The provider's own download link, or null when none is attached. */
  pdfUrl: string | null;
}

/** A payment the event carried, normalised. #989 records these in the payments
 *  table so the admin revenue views can count captured and FAILED charges. */
export interface NormalizedPayment {
  /** The provider's payment id (Razorpay pay_...). */
  providerPaymentId: string;
  /** Smallest currency unit (paise for INR), as the provider reports it, kept
   *  as a string so it never passes through a float. */
  amount: string;
  /** ISO 4217 currency code. */
  currency: string;
  /** "captured" | "failed" | "refunded", as the provider names it. */
  status: string;
}

/** The provider-agnostic shape a verified webhook is normalised to before the
 *  service acts on it. Only the fields the service needs to move a plan. */
export interface NormalizedBillingEvent {
  /** The provider's unique event id — the idempotency key. */
  eventId: string;
  /** The provider's event type, e.g. "subscription.charged". */
  eventType: string;
  /** The provider subscription id this event concerns, when it has one. */
  providerSubscriptionId: string | null;
  /** The subscription lifecycle status this event implies, when it maps to one. */
  status: SubscriptionStatus | null;
  /** #988 — the provider plan id the subscription is on AS OF this event, when
   *  the event carries it. Used to confirm a requested plan change: the change
   *  is applied only once an entitled event reports the subscription on the
   *  target's provider plan id — so an upgrade lands on the next charge and a
   *  downgrade only once the provider actually switches it at the cycle end,
   *  never early. Null for an event with no subscription plan id. */
  providerPlanId: string | null;
  /** End of the current paid period the event reports, when present. */
  currentPeriodEnd: Date | null;
  /** The payment the event carried, when it carried one (a charge/failure), so
   *  #989's revenue views can count captured and failed payments. Null for a
   *  pure lifecycle event with no payment entity. */
  payment: NormalizedPayment | null;
  /** The full verified event body, stored raw. */
  raw: unknown;
}

export interface CreateCheckoutParams {
  planKey: PaidPlanKey;
  interval: BillingInterval;
  /** The workspace the subscription is for; passed to the provider as a note so
   *  an incoming webhook can be tied back even before the local row has the id. */
  workspaceId: string;
  /** The billing owner's email, for the provider's customer record. */
  customerEmail: string;
  /** #992 — an optional offer/coupon id to apply to the new subscription. The
   *  provider applies the discount; SnapURL only validated + recorded the
   *  redemption and passes the id here. Undefined = no coupon. */
  offerId?: string;
  /** #992 — the plan's trial length in days (0 = no trial). When > 0 the
   *  provider starts the subscription with a trial: the first charge is deferred
   *  by this many days and the subscription reports `trialing` until then. */
  trialDays?: number;
  /** #992 — whether a card is required up front for the trial. Forwarded to the
   *  provider's checkout so a no-card trial does not demand payment details. */
  trialRequiresCard?: boolean;
}

/**
 * WHEN a plan change takes effect: immediately (prorated / charged now, an
 * upgrade) or at the end of the current billing cycle (a downgrade, so the
 * owner keeps what they paid for). #988's changePlan derives this from the
 * plan ranking rather than trusting the client.
 */
export type ApplyTiming = "now" | "at_cycle_end";

/**
 * The shape of a subscription change (upgrade/downgrade the plan, optionally
 * apply or clear an offer). #988 issues upgrades and downgrades; the offer
 * field stays forward-compatible for #992.
 */
export interface UpdateSubscriptionParams {
  /** The provider subscription id to change. */
  providerSubscriptionId: string;
  /** The plan key to move to. */
  planKey: PaidPlanKey;
  interval: BillingInterval;
  /** Immediately (prorated) or at the end of the current cycle. */
  when: ApplyTiming;
  /** An offer/coupon id to apply, or null to clear any applied offer. */
  offerId?: string | null;
}

/**
 * #987 — a price change the admin made, pushed to the provider so the money
 * side stays in step with the editable catalogue. `amountMinor` is the integer
 * minor-unit amount (paise/cents) for this (plan key, interval) in `currency`.
 * The provider creates or updates its own plan object for the pair and the
 * SnapURL side keeps only the editable catalogue — no amount is ever read back
 * from the provider.
 */
export interface SyncPlanPriceParams {
  planKey: PaidPlanKey;
  interval: BillingInterval;
  currency: string;
  amountMinor: number;
}

/**
 * #992 §5 — the billing details attached to a provider customer so the
 * invoices it raises carry them. Only the facts an invoice prints: the billing
 * email, the company/legal name, the tax id (a GSTIN in India), and the
 * address split into its lines. Every field is optional — the service passes
 * whatever the owner has entered, and a provider fills in what it supports. No
 * secret and no card data.
 */
export interface SyncBillingDetailsParams {
  /** The provider's customer id for this workspace's subscription, when known.
   *  Null when the workspace has no provider customer yet (nothing to sync). */
  providerCustomerId: string | null;
  /** The provider subscription id, so a provider that attaches details to the
   *  subscription rather than the customer can resolve it. */
  providerSubscriptionId: string | null;
  billingEmail: string | null;
  companyName: string | null;
  taxId: string | null;
  address: {
    line1: string | null;
    line2: string | null;
    city: string | null;
    state: string | null;
    postalCode: string | null;
    country: string | null;
  } | null;
}

export interface BillingProvider {
  /** Which provider this is. The core reads it to decide reachability and to
   *  stamp stored rows. */
  readonly name: BillingProviderName;

  /** True when billing is actually configured and usable. `none` is always
   *  false; `razorpay` is true once its keys are present. The controller uses
   *  this to keep the whole surface unreachable (404) when billing is off. */
  readonly enabled: boolean;

  /** Start a checkout/subscription for a plan + interval. */
  createCheckout(params: CreateCheckoutParams): Promise<CheckoutResult>;

  /** Cancel a subscription at the provider. `atPeriodEnd` keeps the plan live
   *  until the period ends; false cancels immediately. */
  cancel(providerSubscriptionId: string, atPeriodEnd: boolean): Promise<void>;

  /**
   * #988 — change a subscription's plan + interval at the provider, now (an
   * upgrade, prorated) or at the end of the cycle (a downgrade). The plan does
   * NOT move here — only the verified webhook that follows does that (#986).
   */
  updateSubscription(params: UpdateSubscriptionParams): Promise<void>;

  /**
   * #988 — the provider plan id a (plan key, interval) resolves to, or null when
   * it is not configured. Used to CONFIRM a requested plan change: the service
   * applies a pending change only once a verified webhook reports the
   * subscription on this id, so an upgrade lands on the next charge and a
   * downgrade only once the provider actually switches it — never early, never
   * on an unrelated renewal of the old plan.
   */
  resolvePlanId(planKey: PaidPlanKey, interval: BillingInterval): string | null;

  /**
   * #988 — the provider's invoices for a subscription, newest first. Returns an
   * empty list when the provider has none yet (a fresh checkout with no charge).
   */
  listInvoices(providerSubscriptionId: string): Promise<ProviderInvoice[]>;

  /**
   * #987 — sync a plan's price for a (key, interval, currency) to the provider
   * after an admin edits it, so a future checkout charges the new amount.
   * OPTIONAL on the interface: a provider that cannot (or need not) hold a
   * price simply omits it, and the admin edit still lands in the catalogue —
   * the provider sync is best-effort and never gates the DB write. Returns the
   * provider plan id it created/updated, when it has one, for the caller to log.
   */
  syncPlanPrice?(params: SyncPlanPriceParams): Promise<{ providerPlanId: string } | void>;

  /**
   * #992 §5 — push the workspace's billing details (company, tax id, address,
   * billing email) to the provider so its invoices/customer carry them.
   * OPTIONAL on the interface, exactly like syncPlanPrice: a provider that
   * cannot hold them simply omits it, and the owner's edit still lands in the
   * SnapURL record — the provider sync is best-effort and never gates the DB
   * write.
   */
  syncBillingDetails?(params: SyncBillingDetailsParams): Promise<void>;

  /** Refund a payment at the provider. */
  refund(providerPaymentId: string): Promise<void>;

  /**
   * Verify a webhook's signature against the RAW request body and, on success,
   * normalise it. Returns null when the signature does not verify — the ONLY
   * thing that may move a workspace's plan is a call here that returns non-null.
   *
   * `rawBody` MUST be the exact bytes received: the HMAC is over the unmodified
   * body, so a re-serialised object would not match.
   */
  verifyWebhook(rawBody: string, signature: string | undefined): NormalizedBillingEvent | null;
}

/** DI token for the single resolved provider. */
export const BILLING_PROVIDER = Symbol("BILLING_PROVIDER");
