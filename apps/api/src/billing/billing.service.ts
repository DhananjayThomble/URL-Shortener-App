import { Inject, Injectable, Logger } from "@nestjs/common";
import {
  and,
  billingEvents,
  eq,
  memberships,
  payments,
  subscriptions,
  workspacePlanHistory,
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
import { MailService } from "../mail/mail.service.js";
import { CouponsService } from "./coupons.service.js";
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
    /** #987 reads the LIVE price for the (plan, interval) at checkout time from
     *  the editable catalogue; #988 reads the plan rank (sortOrder) to order an
     *  upgrade vs a downgrade. PlansService is global, so one injection serves
     *  both. */
    private readonly plans: PlansService,
    private readonly mail: MailService,
    /** #992 — validates a coupon code and records its one-per-workspace
     *  redemption at checkout; the discount itself is applied by the provider
     *  via the coupon's offer id. */
    private readonly coupons: CouponsService,
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
    couponCode?: string,
  ): Promise<CheckoutSession> {
    // #987 — read the live price the catalogue holds for this plan RIGHT NOW,
    // so the confirmation reflects an admin's edit without a redeploy. The
    // provider's own plan id (resolved in createCheckout) is still what is
    // charged; this amount is informational for the confirmation screen.
    const amountMinor = await this.plans.livePriceMinor(planKey, interval);

    // #992 — resolve the plan's trial config so the provider can start a trial
    // subscription (first charge deferred). A plan with trialDays 0 (the
    // default) starts charging immediately, exactly as before.
    const plan = await this.plans.getByKey(planKey);
    const trialDays = plan?.trialDays ?? 0;
    const trialRequiresCard = plan?.trialRequiresCard ?? true;

    // #992 — validate the coupon BEFORE creating the provider subscription, so
    // an invalid code fails the checkout with a 400 and nothing is created. The
    // discount preview is computed off the live price. Validation does not
    // record a redemption — that is committed only after the subscription
    // exists, below, so a provider failure leaves no phantom redemption.
    const resolvedCoupon = couponCode
      ? await this.coupons.validate(couponCode, planKey, interval, amountMinor ?? 0)
      : null;

    const result = await this.provider.createCheckout({
      workspaceId,
      customerEmail,
      planKey,
      interval,
      // Only a coupon that resolved to a provider offer id discounts at the
      // provider; a coupon with none still validates + records locally.
      offerId: resolvedCoupon?.providerOfferId ?? undefined,
      trialDays,
      trialRequiresCard,
    });

    // #992 — record the redemption now the subscription exists. Atomic on the
    // (coupon, workspace) unique index: a workspace cannot redeem the same
    // coupon twice, and a race cannot exceed max_redemptions. A conflict here
    // surfaces as a 409 to the caller — the subscription was created, but the
    // coupon was already used by this workspace, so the customer retries
    // without it.
    if (resolvedCoupon) {
      await this.coupons.recordRedemption(resolvedCoupon.couponId, workspaceId, planKey, interval);
    }

    // #992 — a trial defers the first charge; record when it ends so the UI can
    // show it. Entitlement is NOT granted here — the subscription row is written
    // "created" below and only the verified `trialing`/`active` webhook moves
    // the plan.
    const trialEndsAt = result.trialEndsAt ?? null;

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
        trialEndsAt,
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
          trialEndsAt,
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
      // #992 — the applied coupon (preview discount only; the provider applies
      // the real discount via the offer). Null when no coupon, or a coupon with
      // no provider offer — nothing is discounted at the provider then.
      coupon:
        resolvedCoupon && resolvedCoupon.providerOfferId
          ? { code: resolvedCoupon.code, discountMinor: resolvedCoupon.discountMinor }
          : null,
      trialEndsAt: trialEndsAt ? trialEndsAt.toISOString() : null,
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
        // A lapsed/free workspace carries no in-flight plan change.
        pendingChange: null,
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
      // #988 — surface a requested-but-unconfirmed plan change so the UI can
      // show "pending change to X". The entitlement (planKey) is unchanged
      // until the confirming webhook; this is only the request.
      pendingChange:
        row.pendingPlanKey && row.pendingInterval
          ? { planKey: row.pendingPlanKey as PaidPlanKey, interval: row.pendingInterval as BillingInterval }
          : null,
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
  async cancelSubscription(
    workspaceId: string,
    atPeriodEnd: boolean,
    survey: { reason: string | null; comment: string | null } = { reason: null, comment: null },
  ): Promise<WorkspaceSubscription> {
    const [row] = await this.db
      .select()
      .from(subscriptions)
      .where(eq(subscriptions.workspaceId, workspaceId))
      .limit(1);

    // #989 — entitlement is read through isEntitled (grace/cancel windows), not
    // a raw status set; only an entitled subscription with a provider id can be
    // cancelled.
    if (!row?.providerSubscriptionId || !isEntitled(lifecycleShape(row), new Date())) {
      throw new NoActiveSubscriptionError();
    }

    await this.provider.cancel(row.providerSubscriptionId, atPeriodEnd);

    const now = new Date();
    await this.db.transaction(async (tx) => {
      // Reflect the pending cancellation for the UI, and record the #992 §6
      // cancellation survey (reason + comment) so the admin panel can show WHY a
      // workspace cancelled. The plan key and entitled status are untouched —
      // the workspace keeps its plan until the verified webhook lapses it. An
      // immediate cancel (atPeriodEnd=false) still waits on the webhook to move
      // the plan; cancel_at_period_end is a TIMESTAMP (the moment a cancellation
      // was scheduled), not a boolean — the wire shape's boolean is derived from
      // it being non-null (currentSubscription coerces it with Boolean(...)).
      await tx
        .update(subscriptions)
        .set({
          cancelAtPeriodEnd: now,
          cancellationReason: survey.reason,
          cancellationComment: survey.comment,
          updatedAt: now,
        })
        .where(eq(subscriptions.id, row.id));

      // #992 §6/§7 — a cancellation lands in the plan history timeline, carrying
      // the survey so the admin reads it alongside every other plan event. The
      // reason column holds the picked reason; the comment rides in metadata.
      await tx.insert(workspacePlanHistory).values({
        workspaceId,
        kind: "cancellation",
        fromPlanKey: row.planKey,
        toPlanKey: null,
        timing: atPeriodEnd ? "period_end" : "immediate",
        settlement: null,
        amountMinor: null,
        currency: null,
        reason: survey.reason,
        actorId: null,
        actorLabel: "owner",
        metadata: { atPeriodEnd, comment: survey.comment },
        effectiveAt: now,
      });
    });

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

    // #989 — entitlement via isEntitled (grace/cancel windows), not a raw
    // status set; only an entitled subscription with a provider id can change.
    if (!row?.providerSubscriptionId || !isEntitled(lifecycleShape(row), new Date())) {
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

    // Record the REQUEST, not the entitlement. planKey/interval are the
    // entitlement of record (handleWebhook mirrors planLabel(planKey) onto
    // workspaces.plan on every entitled event), so writing them here would let
    // the next ordinary entitled webhook — an old-plan renewal charge — grant
    // the target plan with no payment confirmation, and apply a downgrade before
    // its cycle end. Instead the target is held in pendingPlanKey/pendingInterval
    // and applied ONLY when a verified webhook reports the subscription on the
    // target's provider plan id (handleWebhook). The UI reads these to show a
    // "pending change to X" line; entitlement is untouched until the webhook.
    await this.db
      .update(subscriptions)
      .set({ pendingPlanKey: planKey, pendingInterval: interval, updatedAt: new Date() })
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

    // #988 — APPLY A REQUESTED PLAN CHANGE, only when the provider confirms it.
    // changePlan recorded the target in pendingPlanKey/pendingInterval without
    // touching the entitlement. The change lands here, and ONLY here, when this
    // verified+entitled event reports the subscription on the target's provider
    // plan id. That is the single confirmation that holds for both directions:
    // an upgrade is switched immediately so the next charge carries the new plan
    // id; a downgrade is deferred by the provider, so its plan id only changes
    // at the cycle end — the pending change is never applied early, and an
    // unrelated renewal of the OLD plan never matches, so it never grants the
    // target without payment. On a match the target becomes the plan of record
    // and the pending fields clear; otherwise they are left for a later event.
    const pendingTargetId =
      entitled && sub.pendingPlanKey && sub.pendingInterval
        ? this.provider.resolvePlanId(
            sub.pendingPlanKey as PaidPlanKey,
            sub.pendingInterval as BillingInterval,
          )
        : null;
    const applyPending =
      pendingTargetId !== null && event.providerPlanId !== null && event.providerPlanId === pendingTargetId;
    const effectivePlanKey = applyPending ? (sub.pendingPlanKey as PlanKey) : (sub.planKey as PlanKey);
    const effectiveInterval = applyPending ? sub.pendingInterval! : sub.interval;

    await this.db.transaction(async (tx) => {
      await tx
        .update(subscriptions)
        .set({
          status,
          currentPeriodEnd,
          cancelAtPeriodEnd,
          graceEndsAt,
          // Apply the confirmed plan change (and clear the request) only on a
          // provider-confirmed match; otherwise leave planKey/interval and the
          // pending request exactly as they were.
          ...(applyPending
            ? { planKey: effectivePlanKey, interval: effectiveInterval, pendingPlanKey: null, pendingInterval: null }
            : {}),
          updatedAt: now,
        })
        .where(eq(subscriptions.id, sub.id));

      // Mirror the entitlement onto workspaces.plan for the existing settings
      // screen: the plan key's label while entitled, back to Free when lapsed.
      // Uses the EFFECTIVE plan key, so a just-confirmed change is reflected and
      // an unconfirmed one still shows the current plan. DATA IS KEPT either way
      // — only the plan label (and the paid-feature gates that read it) change;
      // nothing deletes the workspace's links.
      await tx
        .update(workspaces)
        .set({ plan: entitled ? planLabel(effectivePlanKey) : "Free", updatedAt: now })
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

  /** #970 — a plan key's rank from the live DB catalogue (its `sortOrder`),
   *  used only to order a change as an upgrade or a downgrade. An unknown key
   *  (not in the catalogue or the compiled-in seed) ranks lowest, so a move AWAY
   *  from it reads as an upgrade and a move TO it as a downgrade — the safe
   *  direction for an unrecognised plan. */
  private async planRank(key: string): Promise<number> {
    const plan = await this.plans.getByKey(key);
    return plan ? plan.sortOrder : UNKNOWN_PLAN_RANK;
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
