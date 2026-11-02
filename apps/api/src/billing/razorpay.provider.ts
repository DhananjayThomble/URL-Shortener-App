import { createHmac, timingSafeEqual } from "node:crypto";
import type { SubscriptionStatus } from "@snapurl/contract";
import type {
  BillingProvider,
  BillingProviderName,
  CheckoutResult,
  CreateCheckoutParams,
  NormalizedBillingEvent,
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

/** Pull the subscription entity out of a Razorpay event payload, tolerant of a
 *  shape that does not carry one. */
function readSubscriptionEntity(raw: unknown): { id?: string; current_end?: number } | null {
  if (typeof raw !== "object" || raw === null) return null;
  const payload = (raw as { payload?: unknown }).payload;
  if (typeof payload !== "object" || payload === null) return null;
  const sub = (payload as { subscription?: unknown }).subscription;
  if (typeof sub !== "object" || sub === null) return null;
  const entity = (sub as { entity?: unknown }).entity;
  if (typeof entity !== "object" || entity === null) return null;
  return entity as { id?: string; current_end?: number };
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
    const subscription = await this.client.createSubscription({
      planId,
      totalCount: TOTAL_CYCLES,
      // The workspace id rides along as a note so a webhook arriving before the
      // local row is written can still be tied back to the workspace.
      notes: { workspaceId: params.workspaceId, planKey: params.planKey, interval: params.interval },
      customerEmail: params.customerEmail,
    });
    // keyId is non-null here: enabled gates the route, so createCheckout is only
    // reached when all three credentials are present.
    return { subscriptionId: subscription.id, keyId: this.config.keyId! };
  }

  async cancel(providerSubscriptionId: string, atPeriodEnd: boolean): Promise<void> {
    await this.client.cancelSubscription(providerSubscriptionId, atPeriodEnd);
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

    const entity = readSubscriptionEntity(raw);
    const currentPeriodEnd =
      entity && typeof entity.current_end === "number" ? new Date(entity.current_end * 1000) : null;

    return {
      // Razorpay delivers the event id in the body's `id` and in the
      // x-razorpay-event-id header; the body id is the canonical one.
      eventId: readEventId(raw),
      eventType,
      providerSubscriptionId: entity && typeof entity.id === "string" ? entity.id : null,
      status: statusForEvent(eventType),
      currentPeriodEnd,
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
