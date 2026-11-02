import { createHmac, timingSafeEqual } from "node:crypto";
import type { SubscriptionStatus } from "@snapurl/contract";
import type {
  BillingProvider,
  BillingProviderName,
  CheckoutResult,
  CreateCheckoutParams,
  NormalizedBillingEvent,
  NormalizedPayment,
  SyncPlanPriceParams,
} from "./billing-provider.js";
import { resolvePlanId, type PlanIdMap } from "./billing-plans.js";

/* ============================================================
   #986 — the Razorpay billing provider (test mode).

   Two concerns, kept apart so each is testable without the other:

   - The HTTP calls to Razorpay (create subscription, cancel, refund) go through
     a RazorpayClient seam, so tests inject a fake and CI never needs a real key
     or a network. The real client wraps the official `razorpay` npm package.

   - verifyWebhook does its OWN HMAC-SHA256 with node:crypto and a constant-time
     comparison — no SDK, no network, no key leaves this process. This is the
     security-critical path, so it is a few lines of standard crypto we can read
     and test directly rather than trusting an opaque library call, and it uses
     timingSafeEqual so a byte-by-byte timing side channel cannot leak the
     expected signature.

   Secrets (keySecret, webhookSecret) are held here, passed in from config; they
   are never returned, logged, or put on the wire. keyId is public.
   ============================================================ */

/** The minimal Razorpay surface this provider uses. The real implementation
 *  delegates to the official package; tests inject a fake. */
export interface RazorpayClient {
  createSubscription(params: {
    planId: string;
    totalCount: number;
    notes: Record<string, string>;
    customerEmail: string;
    /** #992 — an offer/coupon id the provider applies to the subscription, or
     *  undefined for none. */
    offerId?: string;
    /** #992 — epoch SECONDS to defer the first charge to (a trial). Undefined
     *  starts charging immediately (no trial). */
    startAt?: number;
    /** #992 — whether the checkout must collect a card up front. When false
     *  (a no-card trial) Razorpay authenticates the mandate without an upfront
     *  charge. */
    requiresCard?: boolean;
  }): Promise<{ id: string }>;
  cancelSubscription(subscriptionId: string, cancelAtCycleEnd: boolean): Promise<void>;
  refundPayment(paymentId: string): Promise<void>;
  /** #988 — move a subscription to a new plan id. `scheduleChangeAt` is
   *  "now" (prorated upgrade) or "cycle_end" (deferred downgrade), the two
   *  values Razorpay's subscription update accepts. */
  updateSubscription(
    subscriptionId: string,
    params: { planId: string; scheduleChangeAt: "now" | "cycle_end" },
  ): Promise<void>;
  /** #988 — the subscription's invoices, as the provider's raw entities. */
  listInvoices(subscriptionId: string): Promise<RazorpayInvoiceEntity[]>;
  /** #987 — create a Razorpay plan object for an edited price. Razorpay plans
   *  are immutable, so a price change is a NEW plan the next checkout uses;
   *  existing subscriptions keep the plan they were created against. Returns the
   *  new provider plan id. Optional so a fake that does not exercise price sync
   *  need not implement it. */
  createPlan?(params: {
    period: "monthly" | "yearly";
    interval: number;
    amount: number;
    currency: string;
    name: string;
    notes: Record<string, string>;
  }): Promise<{ id: string }>;
}

/** The subset of a Razorpay invoice entity #988 reads. Everything is optional
 *  because the provider's shape is not ours to guarantee; the provider maps it
 *  defensively to ProviderInvoice. */
export interface RazorpayInvoiceEntity {
  id?: string;
  invoice_number?: string | null;
  status?: string;
  amount?: number;
  currency?: string;
  issued_at?: number | null;
  date?: number | null;
  short_url?: string | null;
}

export interface RazorpayProviderConfig {
  keyId: string | undefined;
  keySecret: string | undefined;
  webhookSecret: string | undefined;
  planIds: PlanIdMap;
}

/** How many billing cycles a subscription is created for. Razorpay requires a
 *  bounded total_count; 120 is ten years of monthly cycles — effectively
 *  open-ended for the product, renewed well before it lapses. */
const TOTAL_CYCLES = 120;

/** Milliseconds in a day, for computing a trial's end from its day length. */
const DAY_MS = 24 * 60 * 60 * 1000;

/** Map a Razorpay webhook event type to the subscription status it implies.
 *  An event with no lifecycle meaning (a payment-only event) maps to null —
 *  stored, but moving no plan on its own. */
export function statusForEvent(eventType: string): SubscriptionStatus | null {
  switch (eventType) {
    case "subscription.activated":
    case "subscription.charged":
    case "subscription.resumed":
      return "active";
    case "subscription.authenticated":
      return "authenticated";
    case "subscription.pending":
      return "past_due";
    case "subscription.halted":
      return "halted";
    case "subscription.cancelled":
      return "cancelled";
    case "subscription.completed":
      return "completed";
    case "subscription.expired":
      return "expired";
    default:
      return null;
  }
}

/** #992 — the trial window as the subscription ENTITY reports it, independent of
 *  the event type.
 *
 *  Razorpay has no distinct `trialing` event or entity status: a subscription
 *  created with a future `start_at` (a trial) is reported with entity status
 *  `authenticated` and a `charge_at` in the future until the first charge, when
 *  it flips to `active`. So the honest signal that a subscription is in its
 *  trial is the ENTITY: status `authenticated` AND a future first charge.
 *
 *  When that holds, the subscription is entitled (the customer is using the
 *  plan on trial) — which is exactly our `trialing` status, an entitled state.
 *  That keeps the issue's rule intact: a trial grants the plan only through a
 *  verified webhook (this one), never a local write, and the entitlement is the
 *  provider's reported trial, not a locally-assumed one. Returns null when the
 *  entity does not describe a trial, so the caller falls back to the event-type
 *  status.
 *
 *  `now` is injected so the "future charge" test is deterministic. */
export function trialStatusFromEntity(
  entity: Record<string, unknown> | null,
  now: Date,
): SubscriptionStatus | null {
  if (!entity) return null;
  if (entity.status !== "authenticated") return null;
  const chargeAt = entity.charge_at;
  if (typeof chargeAt !== "number") return null;
  // A first charge strictly in the future means the subscription is in its
  // trial window right now.
  return chargeAt * 1000 > now.getTime() ? "trialing" : null;
}

/** Pull a named entity (`subscription` / `payment`) out of a Razorpay event
 *  payload, tolerant of a shape that does not carry one. Razorpay nests every
 *  entity the same way: payload.<name>.entity. */
function readEntity(raw: unknown, name: "subscription" | "payment"): Record<string, unknown> | null {
  if (typeof raw !== "object" || raw === null) return null;
  const payload = (raw as { payload?: unknown }).payload;
  if (typeof payload !== "object" || payload === null) return null;
  const wrapper = (payload as Record<string, unknown>)[name];
  if (typeof wrapper !== "object" || wrapper === null) return null;
  const entity = (wrapper as { entity?: unknown }).entity;
  if (typeof entity !== "object" || entity === null) return null;
  return entity as Record<string, unknown>;
}

/** Normalise the payment entity a charge/failure event carries, when present.
 *  Razorpay reports the amount as an integer count of the minor unit; kept as a
 *  string so it never passes through a float. */
function readPayment(raw: unknown): NormalizedPayment | null {
  const entity = readEntity(raw, "payment");
  if (!entity) return null;
  const id = entity.id;
  if (typeof id !== "string" || id === "") return null;
  const amount = typeof entity.amount === "number" ? String(entity.amount) : typeof entity.amount === "string" ? entity.amount : null;
  const currency = typeof entity.currency === "string" ? entity.currency : null;
  const status = typeof entity.status === "string" ? entity.status : null;
  if (amount === null || currency === null || status === null) return null;
  return { providerPaymentId: id, amount, currency, status };
}

export class RazorpayBillingProvider implements BillingProvider {
  readonly name: BillingProviderName = "razorpay";

  constructor(
    private readonly config: RazorpayProviderConfig,
    private readonly client: RazorpayClient,
  ) {}

  /** Enabled only when all three credentials are present. A half-configured
   *  deploy (BILLING_PROVIDER=razorpay but a missing secret) reports disabled,
   *  so the routes stay 404 — fail closed, never half-open. */
  get enabled(): boolean {
    return Boolean(this.config.keyId && this.config.keySecret && this.config.webhookSecret);
  }

  async createCheckout(params: CreateCheckoutParams): Promise<CheckoutResult> {
    const planId = resolvePlanId(this.config.planIds, params.planKey, params.interval);
    if (!planId) {
      throw new PlanNotConfiguredError(params.planKey, params.interval);
    }

    // #992 — a plan with trialDays > 0 starts the subscription with the first
    // charge deferred: Razorpay's `start_at` (epoch seconds) pushes the first
    // billing to that instant, and the subscription reports `trialing` until
    // then. The trial end IS that start instant. 0 (or absent) = charge now.
    const trialDays = params.trialDays ?? 0;
    const trialEndsAt = trialDays > 0 ? new Date(Date.now() + trialDays * DAY_MS) : null;

    const subscription = await this.client.createSubscription({
      planId,
      totalCount: TOTAL_CYCLES,
      // The workspace id rides along as a note so a webhook arriving before the
      // local row is written can still be tied back to the workspace.
      notes: { workspaceId: params.workspaceId, planKey: params.planKey, interval: params.interval },
      customerEmail: params.customerEmail,
      // #992 — the coupon's provider offer, when a coupon was applied. The
      // service only passes an id for a validated + recorded coupon.
      offerId: params.offerId,
      // #992 — defer the first charge for a trial; omit for an immediate charge.
      startAt: trialEndsAt ? Math.floor(trialEndsAt.getTime() / 1000) : undefined,
      requiresCard: params.trialRequiresCard,
    });
    // keyId is non-null here: enabled gates the route, so createCheckout is only
    // reached when all three credentials are present.
    return { subscriptionId: subscription.id, keyId: this.config.keyId!, trialEndsAt };
  }

  async cancel(providerSubscriptionId: string, atPeriodEnd: boolean): Promise<void> {
    await this.client.cancelSubscription(providerSubscriptionId, atPeriodEnd);
  }

  /** #988 — the configured provider plan id for a (key, interval), or null. The
   *  free identifier resolvePlanId is the billing-plans helper (imported); this
   *  method is reached via the interface as `provider.resolvePlanId(...)`. */
  resolvePlanId(
    planKey: import("@snapurl/contract").PaidPlanKey,
    interval: import("@snapurl/contract").BillingInterval,
  ): string | null {
    return resolvePlanId(this.config.planIds, planKey, interval) ?? null;
  }

  async updateSubscription(params: import("./billing-provider.js").UpdateSubscriptionParams): Promise<void> {
    const planId = resolvePlanId(this.config.planIds, params.planKey, params.interval);
    if (!planId) {
      // The target plan has no configured provider id — same clean failure as
      // a checkout for an unconfigured plan, not a provider error.
      throw new PlanNotConfiguredError(params.planKey, params.interval);
    }
    await this.client.updateSubscription(params.providerSubscriptionId, {
      planId,
      // "now" prorates an upgrade; "cycle_end" defers a downgrade to the period
      // boundary so the owner keeps what they paid for.
      scheduleChangeAt: params.when === "now" ? "now" : "cycle_end",
    });
  }

  async listInvoices(providerSubscriptionId: string): Promise<import("./billing-provider.js").ProviderInvoice[]> {
    const raw = await this.client.listInvoices(providerSubscriptionId);
    return raw.map(mapInvoice);
  }

  async refund(providerPaymentId: string): Promise<void> {
    await this.client.refundPayment(providerPaymentId);
  }

  /**
   * #987 — sync an edited price to Razorpay. Razorpay plan objects are
   * IMMUTABLE, so a price change creates a NEW Razorpay plan; the next checkout
   * for this (key, interval) is opened against it and existing subscriptions
   * keep the plan they were created against (grandfathering holds at the
   * provider too). Returns the new provider plan id for the caller to log.
   * Best-effort: the admin price edit has already landed in the catalogue; a
   * client that cannot create a plan simply yields nothing.
   */
  async syncPlanPrice(params: SyncPlanPriceParams): Promise<{ providerPlanId: string } | void> {
    if (!this.client.createPlan) return;
    const period = params.interval === "yearly" ? "yearly" : "monthly";
    const created = await this.client.createPlan({
      period,
      interval: 1,
      amount: params.amountMinor,
      currency: params.currency,
      name: `${params.planKey} (${params.interval})`,
      notes: { planKey: params.planKey, interval: params.interval },
    });
    return { providerPlanId: created.id };
  }

  verifyWebhook(rawBody: string, signature: string | undefined): NormalizedBillingEvent | null {
    const secret = this.config.webhookSecret;
    if (!secret || !signature) return null;

    const expected = createHmac("sha256", secret).update(rawBody, "utf8").digest("hex");
    // Constant-time compare. timingSafeEqual throws on a length mismatch, so
    // guard the length first — a signature of the wrong length is simply wrong.
    const expectedBuf = Buffer.from(expected, "utf8");
    const givenBuf = Buffer.from(signature, "utf8");
    if (expectedBuf.length !== givenBuf.length) return null;
    if (!timingSafeEqual(expectedBuf, givenBuf)) return null;

    // Signature verified — parse the raw body exactly once, here, after the HMAC
    // was computed over the same bytes.
    let raw: unknown;
    try {
      raw = JSON.parse(rawBody);
    } catch {
      return null;
    }
    const eventType = typeof (raw as { event?: unknown }).event === "string" ? (raw as { event: string }).event : "";
    if (eventType === "") return null;

    const entity = readEntity(raw, "subscription");
    const currentEnd = entity?.current_end;
    const currentPeriodEnd = typeof currentEnd === "number" ? new Date(currentEnd * 1000) : null;

    // #992 — a subscription in its trial window (entity authenticated + a future
    // first charge) is `trialing`, an entitled state, regardless of the event
    // type that carried it. Fall back to the event-type status otherwise. This
    // is the ONLY place a trial becomes entitled — via a verified webhook, never
    // a local write.
    const status = trialStatusFromEntity(entity, new Date()) ?? statusForEvent(eventType);

    return {
      // Razorpay delivers the event id in the body's `id` and in the
      // x-razorpay-event-id header; the body id is the canonical one.
      eventId: readEventId(raw),
      eventType,
      providerSubscriptionId: entity && typeof entity.id === "string" ? entity.id : null,
      // #988 — the plan id the subscription is on as of this event, so the
      // service can confirm a requested plan change against the provider's own
      // view rather than trusting a locally-written target.
      providerPlanId: entity && typeof entity.plan_id === "string" ? entity.plan_id : null,
      status,
      currentPeriodEnd,
      payment: readPayment(raw),
      raw,
    };
  }
}

/* #988 — normalise a Razorpay invoice status to the contract's closed set. The
 *  provider reports a wider vocabulary; map the ones that carry money meaning
 *  and fall back to `issued` (a raised-but-not-paid invoice) for anything we do
 *  not specifically recognise, so an unexpected value is shown honestly rather
 *  than dropped. */
function normaliseInvoiceStatus(status: string | undefined): import("./billing-provider.js").ProviderInvoice["status"] {
  switch (status) {
    case "paid":
      return "paid";
    case "partially_paid":
      return "partially_paid";
    case "cancelled":
      return "cancelled";
    case "expired":
      return "expired";
    case "issued":
    default:
      return "issued";
  }
}

/* #988 — map a raw Razorpay invoice entity to the provider-neutral shape,
 *  defensively: a missing id becomes an empty string the service can skip, a
 *  missing amount becomes 0, and the currency is upper-cased to the ISO form
 *  the contract requires. `short_url` is the provider's download link. */
function mapInvoice(e: RazorpayInvoiceEntity): import("./billing-provider.js").ProviderInvoice {
  return {
    id: typeof e.id === "string" ? e.id : "",
    number: typeof e.invoice_number === "string" ? e.invoice_number : null,
    status: normaliseInvoiceStatus(e.status),
    amount: typeof e.amount === "number" && Number.isFinite(e.amount) ? Math.max(0, Math.trunc(e.amount)) : 0,
    currency: typeof e.currency === "string" && e.currency !== "" ? e.currency.toUpperCase() : "INR",
    issuedAt: typeof e.issued_at === "number" ? e.issued_at : typeof e.date === "number" ? e.date : 0,
    pdfUrl: typeof e.short_url === "string" && e.short_url !== "" ? e.short_url : null,
  };
}

/** The event's own id from the verified body, or a deterministic fallback so a
 *  body with no id still occupies a unique idempotency slot rather than
 *  colliding with every other id-less event. */
function readEventId(raw: unknown): string {
  const id = (raw as { id?: unknown }).id;
  if (typeof id === "string" && id !== "") return id;
  // No id in the body: hash the body so identical replays still dedupe but two
  // different id-less events do not collide on an empty string.
  return "sha256:" + createHmac("sha256", "razorpay-event-id-fallback").update(JSON.stringify(raw)).digest("hex");
}

/** Thrown when a (plan key, interval) has no configured provider plan id. The
 *  controller maps this to a 400, not a 500 — it is a configuration gap for
 *  that plan, not a server fault. */
export class PlanNotConfiguredError extends Error {
  constructor(planKey: string, interval: string) {
    super(`No Razorpay plan is configured for ${planKey} (${interval}).`);
    this.name = "PlanNotConfiguredError";
  }
}
