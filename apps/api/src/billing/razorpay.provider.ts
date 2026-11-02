import { createHmac, timingSafeEqual } from "node:crypto";
import type { SubscriptionStatus } from "@snapurl/contract";
import type {
  BillingProvider,
  BillingProviderName,
  CheckoutResult,
  CreateCheckoutParams,
  NormalizedBillingEvent,
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
  }): Promise<{ id: string }>;
  cancelSubscription(subscriptionId: string, cancelAtCycleEnd: boolean): Promise<void>;
  refundPayment(paymentId: string): Promise<void>;
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
