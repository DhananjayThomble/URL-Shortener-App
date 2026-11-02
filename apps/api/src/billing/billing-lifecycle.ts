import type { SubscriptionStatus } from "@snapurl/contract";

/* ============================================================
   #989 — subscription lifecycle, as pure functions.

   Entitlement used to be "status ∈ {active, trialing}" (#986). The lifecycle
   work widens it: a workspace keeps its paid plan through a failed-payment
   GRACE window, and through a scheduled cancellation until the period ends.
   Those are time-dependent, so entitlement is now a function of the whole row
   PLUS the current instant — not a set-membership test.

   Keeping the rules here, as pure functions over a plain shape, means both the
   webhook handler (which writes the row) and the read path (which reports it)
   decide entitlement the same way, and the rules are unit-testable with no DB
   and no clock — `now` is always passed in. This is also where the
   mutation-coverage-sensitive branching lives.
   ============================================================ */

/** How long a workspace keeps its plan after a failed payment before it lapses
 *  to free. The issue fixes this at 7 days. Data and links are kept throughout;
 *  only paid-only features stop once it passes. */
export const GRACE_PERIOD_DAYS = 7;
const GRACE_PERIOD_MS = GRACE_PERIOD_DAYS * 24 * 60 * 60 * 1000;

/** The statuses that entitle a workspace outright, with no time condition — a
 *  paid subscription in good standing. */
const HEALTHY_STATUSES: ReadonlySet<SubscriptionStatus> = new Set(["active", "trialing"]);

/** A failed-payment status: the charge did not go through. Razorpay reports
 *  `halted` (retries exhausted) or `pending`→past_due (a retry is scheduled).
 *  Either opens the grace window. */
const FAILED_PAYMENT_STATUSES: ReadonlySet<SubscriptionStatus> = new Set(["past_due", "halted"]);

/** The minimal subscription shape the lifecycle rules read. A subset of the
 *  subscriptions row, so the service passes the row straight in. */
export interface LifecycleSubscription {
  status: SubscriptionStatus;
  /** End of the paid period, or null when unknown. */
  currentPeriodEnd: Date | null;
  /** When a scheduled cancellation lapses the plan, or null when not scheduled. */
  cancelAtPeriodEnd: Date | null;
  /** When the failed-payment grace window lapses, or null when not in grace. */
  graceEndsAt: Date | null;
}

/** Is this a failed-payment status (the trigger for opening a grace window)? */
export function isFailedPaymentStatus(status: SubscriptionStatus): boolean {
  return FAILED_PAYMENT_STATUSES.has(status);
}

/**
 * The grace-window end for a failed payment that happened at `at`.
 *
 * Exactly `GRACE_PERIOD_DAYS` after the failure. Computed from the failure
 * instant, not from the period end, so the owner always gets the full window to
 * fix their card regardless of where in the cycle the charge failed.
 */
export function graceEndFrom(at: Date): Date {
  return new Date(at.getTime() + GRACE_PERIOD_MS);
}

/**
 * Whether the workspace is entitled to its paid plan right now.
 *
 * - A healthy subscription (active/trialing) is entitled.
 * - A failed-payment subscription is entitled WHILE inside its grace window
 *   (graceEndsAt in the future); once grace lapses it is not.
 * - A cancelled subscription is entitled until currentPeriodEnd; after that it
 *   is not. (cancelAtPeriodEnd carries that instant.)
 * - Everything else (created, authenticated, completed, expired, a cancellation
 *   whose period already ended) is not entitled.
 *
 * `now` is always injected so this is deterministic and testable.
 */
export function isEntitled(sub: LifecycleSubscription, now: Date): boolean {
  if (HEALTHY_STATUSES.has(sub.status)) return true;

  if (isFailedPaymentStatus(sub.status)) {
    // In grace while the window has not yet closed. A missing graceEndsAt means
    // no window was opened, so not entitled (fail closed).
    return sub.graceEndsAt != null && sub.graceEndsAt.getTime() > now.getTime();
  }

  if (sub.status === "cancelled") {
    // Entitled until the period ends. A missing period end means the plan is
    // already gone (nothing left to run out), so not entitled.
    return sub.currentPeriodEnd != null && sub.currentPeriodEnd.getTime() > now.getTime();
  }

  return false;
}

/** The in-app notice a client should render, or null when nothing is wrong. */
export interface LifecycleNotice {
  kind: "payment_failed" | "cancellation_scheduled";
  /** When the plan reverts to free if nothing changes. */
  revertsAt: Date | null;
}

/**
 * The notice for a subscription, or null when it needs no attention.
 *
 * Only a subscription that is STILL ENTITLED but on a path to free raises a
 * notice: a failed payment inside its grace window, or a scheduled cancellation
 * before the period end. A subscription that has already lapsed raises no
 * notice (it is simply free now); a healthy one with no pending cancellation
 * raises none either.
 */
export function noticeFor(sub: LifecycleSubscription, now: Date): LifecycleNotice | null {
  if (!isEntitled(sub, now)) return null;

  if (isFailedPaymentStatus(sub.status)) {
    return { kind: "payment_failed", revertsAt: sub.graceEndsAt };
  }

  if (sub.status === "cancelled") {
    return { kind: "cancellation_scheduled", revertsAt: sub.currentPeriodEnd };
  }

  // A healthy subscription that has a cancellation scheduled for the period end
  // (cancelAtPeriodEnd set) but is still active: tell the owner it will end.
  if (HEALTHY_STATUSES.has(sub.status) && sub.cancelAtPeriodEnd != null) {
    return { kind: "cancellation_scheduled", revertsAt: sub.cancelAtPeriodEnd };
  }

  return null;
}
