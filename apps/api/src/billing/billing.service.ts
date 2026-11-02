import { Inject, Injectable, Logger } from "@nestjs/common";
import {
  and,
  billingEvents,
  eq,
  subscriptions,
  workspaces,
  type Database,
} from "@snapurl/database";
import type {
  BillingInterval,
  CheckoutSession,
  PaidPlanKey,
  PlanKey,
  WorkspaceSubscription,
} from "@snapurl/contract";
import { DB } from "../database/database.module.js";
import { PlansService } from "../plans/plans.service.js";
import { BILLING_PROVIDER, type BillingProvider, type NormalizedBillingEvent } from "./billing-provider.js";

/* ============================================================
   #986 — billing service: the only writer of the billing tables, and the only
   place a workspace's plan is moved.

   The invariant the issue turns on: a workspace's plan changes ONLY from a
   verified webhook. So checkout NEVER activates a plan — it creates a provider
   subscription in a pending state and returns the handle for the browser.
   handleWebhook is the one method that moves a plan, and it is called only with
   an event the provider already verified, and it is idempotent on the event id.
   ============================================================ */

/** The paid states: a workspace is entitled to its plan key only while its
 *  subscription sits in one of these. Anything else lapses it back to free. */
const ENTITLED_STATUSES = new Set(["active", "trialing"]);

/** Display label for the workspace's `plan` column, derived from the key. The
 *  entitlement of record is the subscription row's planKey; this keeps the
 *  existing settings screen (which reads workspaces.plan) in step. */
function planLabel(planKey: PlanKey): string {
  return planKey.charAt(0).toUpperCase() + planKey.slice(1);
}

@Injectable()
export class BillingService {
  private readonly logger = new Logger(BillingService.name);

  constructor(
    @Inject(DB) private readonly db: Database,
    @Inject(BILLING_PROVIDER) private readonly provider: BillingProvider,
    /** #987 — read the LIVE price for the (plan, interval) at checkout time from
     *  the editable catalogue. PlansService is global. */
    private readonly plans: PlansService,
  ) {}

  /** Whether the billing surface is reachable at all. The controller reads this
   *  to 404 every route when billing is off or half-configured. */
  get enabled(): boolean {
    return this.provider.enabled;
  }

  /** Verify a webhook's signature against the raw bytes, delegating to the
   *  configured provider. Returns the normalised event, or null when the
   *  signature does not verify. Kept on the service so the controller stays
   *  provider-agnostic. */
  verifyWebhook(rawBody: string, signature: string | undefined): NormalizedBillingEvent | null {
    return this.provider.verifyWebhook(rawBody, signature);
  }

  /**
   * Start a checkout for a plan + interval. Creates the provider subscription
   * and records a local row in a non-entitled "created" state — it does NOT
   * move the workspace's plan. The returned handle is what the browser opens
   * Razorpay Checkout with; activation waits for the verified webhook.
   */
  async startCheckout(
    workspaceId: string,
    customerEmail: string,
    planKey: PaidPlanKey,
    interval: BillingInterval,
  ): Promise<CheckoutSession> {
    const result = await this.provider.createCheckout({ workspaceId, customerEmail, planKey, interval });

    // #987 — read the live price the catalogue holds for this plan RIGHT NOW,
    // so the confirmation reflects an admin's edit without a redeploy. The
    // provider's own plan id (resolved in createCheckout) is still what is
    // charged; this amount is informational for the confirmation screen.
    const amountMinor = await this.plans.livePriceMinor(planKey, interval);

    // Upsert the local row in a pending state. One row per workspace (unique
    // index), so a re-started checkout overwrites the pending handle rather
    // than stacking rows. Critically this writes status "created", never an
    // entitled status — only a webhook does that.
    await this.db
      .insert(subscriptions)
      .values({
        workspaceId,
        planKey,
        interval,
        provider: this.provider.name,
        providerSubscriptionId: result.subscriptionId,
        status: "created",
        updatedAt: new Date(),
      })
      .onConflictDoUpdate({
        target: subscriptions.workspaceId,
        set: {
          planKey,
          interval,
          provider: this.provider.name,
          providerSubscriptionId: result.subscriptionId,
          status: "created",
          updatedAt: new Date(),
        },
      });

    return {
      provider: "razorpay",
      subscriptionId: result.subscriptionId,
      keyId: result.keyId,
      planKey,
      interval,
      amountMinor,
      currency: "INR",
    };
  }

  /** The workspace's current subscription, or the free shape when it has none. */
  async currentSubscription(workspaceId: string): Promise<WorkspaceSubscription> {
    const [row] = await this.db
      .select()
      .from(subscriptions)
      .where(eq(subscriptions.workspaceId, workspaceId))
      .limit(1);

    if (!row || !ENTITLED_STATUSES.has(row.status)) {
      // No row, or a lapsed one: the workspace is on free. Report the lapsed
      // row's status honestly when there is one, so the UI can say "expired"
      // rather than pretending nothing was ever bought.
      return {
        planKey: "free",
        interval: (row?.interval as BillingInterval | undefined) ?? null,
        status: (row?.status as WorkspaceSubscription["status"]) ?? null,
        currentPeriodEnd: row?.currentPeriodEnd ? row.currentPeriodEnd.toISOString() : null,
        cancelAtPeriodEnd: Boolean(row?.cancelAtPeriodEnd),
      };
    }

    return {
      planKey: row.planKey as PlanKey,
      interval: row.interval as BillingInterval,
      status: row.status as WorkspaceSubscription["status"],
      currentPeriodEnd: row.currentPeriodEnd ? row.currentPeriodEnd.toISOString() : null,
      cancelAtPeriodEnd: Boolean(row.cancelAtPeriodEnd),
    };
  }

  /**
   * Process a verified webhook event. THE ONLY path that moves a plan.
   *
   * Idempotent on the provider event id: the event is inserted into
   * billing_events first, and the unique (provider, event id) index means a
   * replay of an already-seen event is a conflict that writes nothing and
   * returns `duplicate` without touching the subscription or the workspace.
   *
   * `event` MUST come from provider.verifyWebhook returning non-null — the
   * caller never hands an unverified event here.
   */
  async handleWebhook(event: NormalizedBillingEvent): Promise<"processed" | "duplicate" | "ignored"> {
    // Resolve the workspace this event is about from the stored subscription row.
    const [sub] = event.providerSubscriptionId
      ? await this.db
          .select()
          .from(subscriptions)
          .where(
            and(
              eq(subscriptions.provider, this.provider.name),
              eq(subscriptions.providerSubscriptionId, event.providerSubscriptionId),
            ),
          )
          .limit(1)
      : [];

    // Record the event FIRST, idempotently. onConflictDoNothing on the unique
    // (provider, event id) index is the replay guard: a duplicate inserts zero
    // rows, and we stop before touching any plan.
    const inserted = await this.db
      .insert(billingEvents)
      .values({
        provider: this.provider.name,
        providerEventId: event.eventId,
        eventType: event.eventType,
        workspaceId: sub?.workspaceId ?? null,
        payload: event.raw as object,
      })
      .onConflictDoNothing({ target: [billingEvents.provider, billingEvents.providerEventId] })
      .returning({ id: billingEvents.id });

    if (inserted.length === 0) {
      // Already processed this event id. Changes nothing.
      return "duplicate";
    }

    // An event about a subscription we have no row for: stored for the record,
    // but there is no plan to move.
    if (!sub) return "ignored";

    // An event with no lifecycle meaning (a payment-only event): stored, event
    // recorded, but it moves no plan on its own.
    if (event.status === null) {
      await this.markEventProcessed(event.eventId);
      return "processed";
    }

    const entitled = ENTITLED_STATUSES.has(event.status);
    await this.db.transaction(async (tx) => {
      await tx
        .update(subscriptions)
        .set({
          status: event.status!,
          currentPeriodEnd: event.currentPeriodEnd ?? sub.currentPeriodEnd,
          updatedAt: new Date(),
        })
        .where(eq(subscriptions.id, sub.id));

      // Mirror the entitlement onto workspaces.plan for the existing settings
      // screen: the plan key's label while entitled, back to Free when lapsed.
      await tx
        .update(workspaces)
        .set({ plan: entitled ? planLabel(sub.planKey as PlanKey) : "Free", updatedAt: new Date() })
        .where(eq(workspaces.id, sub.workspaceId));
    });

    await this.markEventProcessed(event.eventId);
    this.logger.log(
      `billing webhook ${event.eventType} → workspace ${sub.workspaceId} plan ${entitled ? sub.planKey : "free"}`,
    );
    return "processed";
  }

  private async markEventProcessed(eventId: string): Promise<void> {
    await this.db
      .update(billingEvents)
      .set({ processedAt: new Date() })
      .where(and(eq(billingEvents.provider, this.provider.name), eq(billingEvents.providerEventId, eventId)));
  }
}
