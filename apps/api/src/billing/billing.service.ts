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
  BillingInvoice,
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

/* #988 / #970 — the TIMING of a plan change (upgrade now vs downgrade at cycle
   end) is decided by the plan's `sortOrder` in the live DB catalogue, read
   through PlansService — NOT a hard-coded rank. An admin can reorder or add
   plans and the upgrade/downgrade direction stays correct. The fallback below
   is only reached for a key that is in neither the DB catalogue nor the
   compiled-in seed, which PlansService already resolves to `free`. */
const UNKNOWN_PLAN_RANK = 0;

/** Raised when a plan change targets the plan the workspace is already on. The
 *  controller maps it to a 400 — nothing to change, not a server fault. */
export class SamePlanError extends Error {
  constructor(planKey: string, interval: string) {
    super(`The workspace is already on ${planKey} (${interval}).`);
    this.name = "SamePlanError";
  }
}

/** Raised when a plan change or cancel is asked for but the workspace has no
 *  active paid subscription to change. The controller maps it to a 400. */
export class NoActiveSubscriptionError extends Error {
  constructor() {
    super("The workspace has no active subscription to change. Start a checkout first.");
    this.name = "NoActiveSubscriptionError";
  }
}

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
    /** #987 reads the LIVE price for the (plan, interval) at checkout time from
     *  the editable catalogue; #988 reads the plan rank (sortOrder) to order an
     *  upgrade vs a downgrade. PlansService is global, so one injection serves
     *  both. */
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
   * #988 — the workspace's invoices, newest first. Reads the stored
   * subscription row for the provider subscription id and asks the provider;
   * a workspace with no provider subscription has no invoices (empty list), not
   * an error. Maps the provider shape onto the contract's BillingInvoice; an
   * invoice the provider returned with no id is dropped (it is not addressable).
   */
  async listInvoices(workspaceId: string): Promise<BillingInvoice[]> {
    const [row] = await this.db
      .select()
      .from(subscriptions)
      .where(eq(subscriptions.workspaceId, workspaceId))
      .limit(1);

    if (!row?.providerSubscriptionId) return [];

    const invoices = await this.provider.listInvoices(row.providerSubscriptionId);
    return invoices
      .filter((inv) => inv.id !== "")
      .map((inv) => ({
        id: inv.id,
        number: inv.number,
        status: inv.status,
        amount: inv.amount,
        currency: inv.currency,
        createdAt: new Date(inv.issuedAt * 1000).toISOString(),
        pdfUrl: inv.pdfUrl,
      }))
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  }

  /**
   * #988 — schedule the workspace's subscription to end. `atPeriodEnd` true (the
   * default the UI sends) keeps the plan live until the period ends; false
   * cancels immediately. This asks the provider only — the plan does NOT move
   * here. The provider's cancellation webhook, verified, is what lapses the
   * workspace back to free (#986's invariant), so this writes
   * `cancelAtPeriodEnd` locally for the UI to reflect the pending state and
   * leaves the entitlement untouched until the webhook arrives.
   */
  async cancelSubscription(workspaceId: string, atPeriodEnd: boolean): Promise<WorkspaceSubscription> {
    const [row] = await this.db
      .select()
      .from(subscriptions)
      .where(eq(subscriptions.workspaceId, workspaceId))
      .limit(1);

    if (!row?.providerSubscriptionId || !ENTITLED_STATUSES.has(row.status)) {
      throw new NoActiveSubscriptionError();
    }

    await this.provider.cancel(row.providerSubscriptionId, atPeriodEnd);

    // Reflect the pending cancellation for the UI. The plan key and entitled
    // status are untouched — the workspace keeps its plan until the verified
    // webhook lapses it. An immediate cancel (atPeriodEnd=false) still waits on
    // the webhook to move the plan; cancel_at_period_end is a TIMESTAMP (the
    // moment a cancellation was scheduled), not a boolean — the wire shape's
    // boolean cancelAtPeriodEnd is derived from it being non-null
    // (currentSubscription coerces it with Boolean(...)).
    await this.db
      .update(subscriptions)
      .set({ cancelAtPeriodEnd: new Date(), updatedAt: new Date() })
      .where(eq(subscriptions.id, row.id));

    return this.currentSubscription(workspaceId);
  }

  /**
   * #988 — change the workspace between paid plans. Derives the TIMING from the
   * plan ranking rather than trusting the caller: a move to a higher plan is an
   * upgrade applied now (prorated); a move to a lower plan is a downgrade
   * deferred to the cycle end. Asks the provider only — as everywhere, the plan
   * actually moves when the resulting verified webhook arrives. Returns the
   * subscription as it stands (still the old plan until the webhook lands),
   * with the new target recorded on the local row so the UI can show "changing
   * to X".
   */
  async changePlan(
    workspaceId: string,
    planKey: PaidPlanKey,
    interval: BillingInterval,
  ): Promise<WorkspaceSubscription> {
    const [row] = await this.db
      .select()
      .from(subscriptions)
      .where(eq(subscriptions.workspaceId, workspaceId))
      .limit(1);

    if (!row?.providerSubscriptionId || !ENTITLED_STATUSES.has(row.status)) {
      throw new NoActiveSubscriptionError();
    }

    // Nothing to do when the target is the plan + interval already in force.
    if (row.planKey === planKey && row.interval === interval) {
      throw new SamePlanError(planKey, interval);
    }

    // Upgrade (higher sortOrder in the live catalogue) takes effect now,
    // prorated; a downgrade is deferred to the cycle end. Read the ranks from
    // PlansService so an admin-edited catalogue stays authoritative.
    const [targetRank, currentRank] = await Promise.all([
      this.planRank(planKey),
      this.planRank(row.planKey),
    ]);
    const when: "now" | "at_cycle_end" = targetRank > currentRank ? "now" : "at_cycle_end";

    await this.provider.updateSubscription({
      providerSubscriptionId: row.providerSubscriptionId,
      planKey,
      interval,
      when,
    });

    // Record the intended target locally. The entitled status is left as-is so
    // the workspace keeps its current plan until the provider's webhook confirms
    // the change; interval is updated to the target so the UI reflects the
    // pending switch.
    await this.db
      .update(subscriptions)
      .set({ planKey, interval, updatedAt: new Date() })
      .where(eq(subscriptions.id, row.id));

    return this.currentSubscription(workspaceId);
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

  /** #970 — a plan key's rank from the live DB catalogue (its `sortOrder`),
   *  used only to order a change as an upgrade or a downgrade. An unknown key
   *  (not in the catalogue or the compiled-in seed) ranks lowest, so a move AWAY
   *  from it reads as an upgrade and a move TO it as a downgrade — the safe
   *  direction for an unrecognised plan. */
  private async planRank(key: string): Promise<number> {
    const plan = await this.plans.getByKey(key);
    return plan ? plan.sortOrder : UNKNOWN_PLAN_RANK;
  }
}
