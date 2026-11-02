import { Inject, Injectable, Logger } from "@nestjs/common";
import {
  and,
  billingEvents,
  eq,
  memberships,
  payments,
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
import { MailService } from "../mail/mail.service.js";
import { BILLING_PROVIDER, type BillingProvider, type NormalizedBillingEvent } from "./billing-provider.js";
import {
  graceEndFrom,
  isEntitled,
  isFailedPaymentStatus,
  noticeFor,
  type LifecycleSubscription,
} from "./billing-lifecycle.js";

/* ============================================================
   #986 — billing service: the only writer of the billing tables, and the only
   place a workspace's plan is moved.

   The invariant the issue turns on: a workspace's plan changes ONLY from a
   verified webhook. So checkout NEVER activates a plan — it creates a provider
   subscription in a pending state and returns the handle for the browser.
   handleWebhook is the one method that moves a plan, and it is called only with
   an event the provider already verified, and it is idempotent on the event id.
   ============================================================ */

/** A stored payment row, as drizzle returns it. */
export type PaymentRow = typeof payments.$inferSelect;

/** The result of a refund attempt. The caller (AdminBillingService) maps each
 *  outcome to an HTTP response and, on success, an audit entry. */
export type RefundOutcome =
  | { outcome: "not_found" }
  | { outcome: "not_refundable"; payment: PaymentRow }
  | { outcome: "already_refunded"; payment: PaymentRow }
  | { outcome: "refunded"; payment: PaymentRow; before: PaymentRow };

/** Display label for the workspace's `plan` column, derived from the key. The
 *  entitlement of record is the subscription row's planKey; this keeps the
 *  existing settings screen (which reads workspaces.plan) in step. */
function planLabel(planKey: PlanKey): string {
  return planKey.charAt(0).toUpperCase() + planKey.slice(1);
}

/** The subscriptions-row fields the lifecycle rules read, pulled into the plain
 *  shape they take. Dates are already Date | null off the drizzle row. */
function lifecycleShape(row: {
  status: string;
  currentPeriodEnd: Date | null;
  cancelAtPeriodEnd: Date | null;
  graceEndsAt: Date | null;
}): LifecycleSubscription {
  return {
    status: row.status as LifecycleSubscription["status"],
    currentPeriodEnd: row.currentPeriodEnd,
    cancelAtPeriodEnd: row.cancelAtPeriodEnd,
    graceEndsAt: row.graceEndsAt,
  };
}

@Injectable()
export class BillingService {
  private readonly logger = new Logger(BillingService.name);

  constructor(
    @Inject(DB) private readonly db: Database,
    @Inject(BILLING_PROVIDER) private readonly provider: BillingProvider,
    private readonly mail: MailService,
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
   * #989 — refund a stored payment at the provider, then mark it refunded
   * locally. Admin-only and audited by the CALLER (AdminBillingService); this
   * method does the provider call + the local status flip, and returns the row
   * so the caller can record the before/after in the admin audit log.
   *
   * The money moves at the provider for the full captured amount — no partial
   * amount is accepted, so a client can never name a figure. Refunding is
   * idempotent-ish: a payment already `refunded` is returned unchanged without
   * a second provider call. A payment that was never `captured` cannot be
   * refunded (there is nothing to return) and is rejected.
   */
  async refundPayment(paymentId: string): Promise<RefundOutcome> {
    const [row] = await this.db.select().from(payments).where(eq(payments.id, paymentId)).limit(1);
    if (!row) return { outcome: "not_found" };
    if (row.status === "refunded") {
      return { outcome: "already_refunded", payment: row };
    }
    if (row.status !== "captured") {
      // Only a captured payment can be refunded — a failed charge took no money.
      return { outcome: "not_refundable", payment: row };
    }

    // Provider call first: if it throws, the local row is NOT flipped, so a
    // failed refund is visible (the payment stays captured) rather than being
    // marked refunded when no money moved.
    await this.provider.refund(row.providerPaymentId);

    const [updated] = await this.db
      .update(payments)
      .set({ status: "refunded" })
      .where(eq(payments.id, paymentId))
      .returning();
    return { outcome: "refunded", payment: updated ?? row, before: row };
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
    };
  }

  /**
   * The workspace's current subscription, or the free shape when it has none.
   *
   * #989 — entitlement is no longer "status is active/trialing": a failed
   * payment keeps the plan through its grace window, and a cancellation keeps
   * it until the period ends (see billing-lifecycle). So entitlement is read
   * through isEntitled(row, now), and a `notice` block is attached when the
   * subscription is still entitled but on a path back to free, so the client
   * can show the in-app grace / cancellation banner.
   */
  async currentSubscription(workspaceId: string, now: Date = new Date()): Promise<WorkspaceSubscription> {
    const [row] = await this.db
      .select()
      .from(subscriptions)
      .where(eq(subscriptions.workspaceId, workspaceId))
      .limit(1);

    if (!row || !isEntitled(lifecycleShape(row), now)) {
      // No row, or a lapsed one: the workspace is on free. Report the lapsed
      // row's status honestly when there is one, so the UI can say "expired"
      // rather than pretending nothing was ever bought. A lapsed row raises no
      // notice — it is simply free now.
      return {
        planKey: "free",
        interval: (row?.interval as BillingInterval | undefined) ?? null,
        status: (row?.status as WorkspaceSubscription["status"]) ?? null,
        currentPeriodEnd: row?.currentPeriodEnd ? row.currentPeriodEnd.toISOString() : null,
        cancelAtPeriodEnd: Boolean(row?.cancelAtPeriodEnd),
        notice: null,
      };
    }

    const notice = noticeFor(lifecycleShape(row), now);
    return {
      planKey: row.planKey as PlanKey,
      interval: row.interval as BillingInterval,
      status: row.status as WorkspaceSubscription["status"],
      currentPeriodEnd: row.currentPeriodEnd ? row.currentPeriodEnd.toISOString() : null,
      cancelAtPeriodEnd: Boolean(row.cancelAtPeriodEnd),
      notice: notice ? { kind: notice.kind, revertsAt: notice.revertsAt ? notice.revertsAt.toISOString() : null } : null,
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

    const now = new Date();

    // Record the payment the event carried (a charge or a failure), so the
    // #989 admin revenue views can count captured and FAILED payments. Upserted
    // idempotently on (provider, provider payment id): a replayed charge event
    // (a different event id but the same payment) does not double-count.
    if (event.payment) {
      await this.db
        .insert(payments)
        .values({
          workspaceId: sub.workspaceId,
          provider: this.provider.name,
          providerPaymentId: event.payment.providerPaymentId,
          providerSubscriptionId: sub.providerSubscriptionId,
          amount: event.payment.amount,
          currency: event.payment.currency,
          status: event.payment.status,
        })
        .onConflictDoUpdate({
          target: [payments.provider, payments.providerPaymentId],
          set: { status: event.payment.status },
        });
    }

    // An event with no lifecycle meaning (a payment-only event, e.g.
    // payment.captured with no subscription status): the payment above is
    // recorded, the event stored, but it moves no plan on its own.
    if (event.status === null) {
      await this.markEventProcessed(event.eventId);
      return "processed";
    }

    const status = event.status;
    const failedPayment = isFailedPaymentStatus(status);
    // A failed payment OPENS a grace window the first time it is seen: the plan
    // stays entitled for GRACE_PERIOD_DAYS. A repeat failure while already in
    // grace keeps the ORIGINAL window (do not extend it on every retry). Any
    // other status clears the window — a re-activation (active) ends grace, and
    // a terminal status (expired/cancelled) has its own entitlement rule.
    const graceEndsAt = failedPayment ? (sub.graceEndsAt ?? graceEndFrom(now)) : null;
    // A cancellation keeps the plan until the period end; record that instant so
    // isEntitled can keep it live until then. Any other status clears it.
    const cancelAtPeriodEnd =
      status === "cancelled" ? (event.currentPeriodEnd ?? sub.currentPeriodEnd ?? null) : null;
    const currentPeriodEnd = event.currentPeriodEnd ?? sub.currentPeriodEnd;

    // Entitlement is computed from the NEW row state, through the same rule the
    // read path uses — not a status set-membership test.
    const entitled = isEntitled(
      { status, currentPeriodEnd, cancelAtPeriodEnd, graceEndsAt },
      now,
    );

    await this.db.transaction(async (tx) => {
      await tx
        .update(subscriptions)
        .set({
          status,
          currentPeriodEnd,
          cancelAtPeriodEnd,
          graceEndsAt,
          updatedAt: now,
        })
        .where(eq(subscriptions.id, sub.id));

      // Mirror the entitlement onto workspaces.plan for the existing settings
      // screen: the plan key's label while entitled, back to Free when lapsed.
      // DATA IS KEPT either way — only the plan label (and the paid-feature
      // gates that read it) change; nothing deletes the workspace's links.
      await tx
        .update(workspaces)
        .set({ plan: entitled ? planLabel(sub.planKey as PlanKey) : "Free", updatedAt: now })
        .where(eq(workspaces.id, sub.workspaceId));
    });

    // Tell the owner their payment failed and the plan will lapse after the
    // grace window — but only when we have JUST opened the window (the sub was
    // not already in grace), so a retry storm does not email on every delivery.
    // Best-effort: a mail failure never fails the webhook (Razorpay would retry
    // the whole event and we would re-open nothing but could re-email).
    if (failedPayment && sub.graceEndsAt == null) {
      await this.notifyPaymentFailed(sub.workspaceId, graceEndsAt!).catch((err) =>
        this.logger.warn({ err, workspaceId: sub.workspaceId }, "failed-payment notice email did not send"),
      );
    }

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

  /** Email the workspace's owner that a payment failed and the plan lapses to
   *  free after the grace window unless they update their card. Resolves the
   *  owner's email from the active owner membership; a workspace with no active
   *  owner (should not happen) simply gets no email, which is logged by the
   *  caller's catch. */
  private async notifyPaymentFailed(workspaceId: string, graceEndsAt: Date): Promise<void> {
    const [owner] = await this.db
      .select({ email: memberships.email })
      .from(memberships)
      .where(
        and(
          eq(memberships.workspaceId, workspaceId),
          eq(memberships.role, "owner"),
          eq(memberships.status, "active"),
        ),
      )
      .limit(1);
    if (!owner?.email) return;
    await this.mail.sendPaymentFailed({ to: owner.email, graceEndsAt });
  }
}
