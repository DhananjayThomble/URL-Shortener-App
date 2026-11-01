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
  /** End of the current paid period the event reports, when present. */
  currentPeriodEnd: Date | null;
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
