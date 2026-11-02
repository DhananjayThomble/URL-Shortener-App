import { z } from "zod";
import { BILLING_INTERVALS, PLAN_KEYS, SUBSCRIPTION_STATUSES } from "./billing.js";

/* ============================================================
   #989 — admin billing views (epic #991), part of the platform admin panel.

   The operator's window onto the money: the subscriptions list, the revenue
   headline (MRR, active subs by plan, churn, failed payments), and one
   workspace's billing-event history. Plus the one admin WRITE in this part — a
   refund — which goes through the provider's refund API, carries a reason, and
   is recorded in the platform admin audit log (writeAdminAuditEntry). There is
   no self-serve refund: this surface is admin-only (AdminGuard), as every other
   /admin route is.

   These are READ shapes (plus the refund input). The refund is audited in the
   service; the reads are not, exactly like the #973 analytics reads.
   ============================================================ */

/** One row of the admin subscriptions list: who is on what plan, in what
 *  lifecycle state, and the two instants that decide whether the plan is about
 *  to lapse. Amounts live with the provider, so nothing here carries money. */
export const AdminSubscriptionRow = z.object({
  workspaceId: z.string().uuid(),
  workspaceName: z.string(),
  planKey: z.enum(PLAN_KEYS),
  interval: z.enum(BILLING_INTERVALS).nullable(),
  status: z.enum(SUBSCRIPTION_STATUSES),
  /** ISO-8601 end of the current paid period, or null when none is known. */
  currentPeriodEnd: z.string().nullable(),
  /** ISO-8601 — when a scheduled cancellation takes the plan to free, or null. */
  cancelAtPeriodEnd: z.string().nullable(),
  /** ISO-8601 — when the failed-payment grace window lapses to free, or null
   *  when the subscription is not in grace. */
  graceEndsAt: z.string().nullable(),
  updatedAt: z.string(),
});
export type AdminSubscriptionRow = z.infer<typeof AdminSubscriptionRow>;

export const AdminSubscriptionList = z.object({
  subscriptions: z.array(AdminSubscriptionRow),
});
export type AdminSubscriptionList = z.infer<typeof AdminSubscriptionList>;

/** A ranked (label, value) row — active subscribers per plan. */
export const AdminRevenueRankRow = z.object({ label: z.string(), value: z.number().int() });
export type AdminRevenueRankRow = z.infer<typeof AdminRevenueRankRow>;

/**
 * The revenue headline.
 *
 * MRR is normalised monthly recurring revenue in the SMALLEST currency unit
 * (paise for INR): a yearly subscription contributes 1/12 of its yearly price.
 * It is a string, not a number, because it is a count of minor units that must
 * never pass through a float — the same reason payments.amount is text. The
 * figure is derived from the active subscriptions and the configured plan
 * prices; when no price is configured for a (plan, interval) that subscription
 * contributes 0 and is counted in `mrrUnpricedSubscriptions`, so a missing
 * price is visible rather than silently dropping revenue.
 */
export const AdminRevenue = z.object({
  /** Normalised monthly recurring revenue, smallest currency unit, as a string. */
  mrr: z.string(),
  /** The currency the MRR is in (ISO 4217), or null when nothing is priced. */
  currency: z.string().nullable(),
  /** Active (entitled) subscriptions whose (plan, interval) had no configured
   *  price, so they contributed 0 to MRR — surfaced, not hidden. */
  mrrUnpricedSubscriptions: z.number().int(),
  /** Count of currently-entitled subscriptions. */
  activeSubscriptions: z.number().int(),
  /** Entitled subscribers per plan key, largest first. */
  activeByPlan: z.array(AdminRevenueRankRow),
  /** Churn over the window: subscriptions that left an entitled state (expired,
   *  cancelled-and-lapsed) in the window, and the churn rate against the count
   *  entitled at the window's start. */
  churnedInWindow: z.number().int(),
  /** churnedInWindow / entitled-at-window-start, 0..1 rounded to 4dp, or null
   *  when there were none entitled at the start (no basis). */
  churnRate: z.number().nullable(),
  /** Payments that FAILED in the window (payments.status = 'failed'). */
  failedPaymentsInWindow: z.number().int(),
  /** Subscriptions currently in a failed-payment grace window. */
  inGrace: z.number().int(),
});
export type AdminRevenue = z.infer<typeof AdminRevenue>;

/** One billing event for a workspace, as the per-workspace history returns it.
 *  The raw provider payload is NOT included — only the fields an operator reads
 *  at a glance; the full payload stays in the table for forensics. */
export const AdminBillingEventRow = z.object({
  id: z.string().uuid(),
  provider: z.string(),
  providerEventId: z.string(),
  eventType: z.string(),
  /** ISO-8601 when the event was received. */
  receivedAt: z.string(),
  /** ISO-8601 when the handler finished acting on it, or null if unprocessed. */
  processedAt: z.string().nullable(),
});
export type AdminBillingEventRow = z.infer<typeof AdminBillingEventRow>;

export const AdminWorkspaceBillingEvents = z.object({
  workspaceId: z.string().uuid(),
  events: z.array(AdminBillingEventRow),
});
export type AdminWorkspaceBillingEvents = z.infer<typeof AdminWorkspaceBillingEvents>;

/**
 * The admin refund body. A reason is REQUIRED and recorded in the audit log —
 * a refund with no stated reason is not accepted. The refund targets a stored
 * payment by its id (a path param); this body carries only the reason, so a
 * client cannot name an amount (a refund is for the full captured amount at the
 * provider — no partial-refund amount is taken from the client).
 */
export const AdminRefundInput = z
  .object({
    reason: z.string().trim().min(1, "A refund reason is required.").max(500),
  })
  .strict();
export type AdminRefundInput = z.infer<typeof AdminRefundInput>;

/** What a completed refund reports back: the payment it refunded and its new
 *  status. The money moved at the provider; this is the local record's view. */
export const AdminRefundResult = z.object({
  paymentId: z.string().uuid(),
  providerPaymentId: z.string(),
  status: z.literal("refunded"),
});
export type AdminRefundResult = z.infer<typeof AdminRefundResult>;
