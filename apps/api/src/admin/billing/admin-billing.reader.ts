import {
  and,
  billingEvents,
  desc,
  eq,
  gte,
  lt,
  payments,
  sql,
  subscriptions,
  workspaces,
  type Database,
} from "@snapurl/database";

/* ============================================================
   #989 — the admin billing-view READ path, behind a port.

   Same seam as the #973 admin-analytics reader: the service holds the
   store-agnostic shaping (window math, MRR normalisation, churn rate, the
   entitlement rule), and this adapter does nothing but read the billing tables.
   Constructed off the read replica (READ_DB) because every method is a pure
   aggregation with no write.

   `now` and the window bounds are passed in by the service, so the reader
   carries no clock and the service's unit tests can pin the behaviour.
   ============================================================ */

/** DI token bound to PostgresAdminBillingReader off the read replica. */
export const ADMIN_BILLING_READER = Symbol("ADMIN_BILLING_READER");

/** The entitling statuses + the two time-conditioned ones, as the reader needs
 *  them for SQL. Kept in step with billing-lifecycle's rules: active/trialing
 *  are entitled outright; a halted/past_due row is entitled while grace_ends_at
 *  is in the future; a cancelled row while current_period_end is in the future. */
export interface SubscriptionReadRow {
  workspaceId: string;
  workspaceName: string;
  planKey: string;
  interval: string | null;
  status: string;
  currentPeriodEnd: Date | null;
  cancelAtPeriodEnd: Date | null;
  graceEndsAt: Date | null;
  updatedAt: Date;
}

export interface BillingEventReadRow {
  id: string;
  provider: string;
  providerEventId: string;
  eventType: string;
  receivedAt: Date;
  processedAt: Date | null;
}

/** A (planKey, interval) with the latest captured payment amount for one
 *  entitled subscription, so the service can normalise it to monthly MRR. */
export interface ActiveSubscriptionAmount {
  workspaceId: string;
  planKey: string;
  interval: string | null;
  /** The most recent captured payment amount for this subscription (minor
   *  units, as text), or null when it has none yet. */
  latestCapturedAmount: string | null;
  currency: string | null;
}

export interface AdminBillingReader {
  /** Every subscription row with its workspace name, newest-updated first. */
  allSubscriptions(): Promise<SubscriptionReadRow[]>;
  /** The billing events for one workspace, newest first. */
  workspaceEvents(workspaceId: string): Promise<BillingEventReadRow[]>;
  /** One row per CURRENTLY-ENTITLED subscription with its latest captured
   *  payment amount, for the MRR + active-by-plan figures. `now` decides the
   *  grace/period-end conditions. */
  entitledSubscriptionAmounts(now: Date): Promise<ActiveSubscriptionAmount[]>;
  /** Count of subscriptions that LEFT an entitled state in [start, end): moved
   *  to expired/completed, or a cancelled/halted row whose window closed inside
   *  the window. Approximated by updated_at landing in the window with a
   *  non-entitled terminal status. */
  churnedInWindow(start: Date, end: Date): Promise<number>;
  /** Count entitled at a given instant (the churn-rate denominator). */
  entitledCountAt(now: Date): Promise<number>;
  /** Payments with status 'failed' whose row was created in [start, end). */
  failedPaymentsInWindow(start: Date, end: Date): Promise<number>;
  /** Subscriptions currently in a failed-payment grace window (grace_ends_at in
   *  the future). */
  inGraceCount(now: Date): Promise<number>;
}

/** A Date as a timestamptz bind param for a raw `sql` fragment. postgres-js
 *  does not serialise a bare JS Date interpolated into a sql template (it is
 *  not a drizzle column comparison), so pass the ISO string with an explicit
 *  cast — the server parses it back to the same instant. */
function ts(d: Date) {
  return sql`${d.toISOString()}::timestamptz`;
}

/** SQL fragment: is a subscription row entitled at `now`? Mirrors
 *  billing-lifecycle.isEntitled exactly. */
function entitledAt(now: Date) {
  return sql`(
    ${subscriptions.status} in ('active', 'trialing')
    or (${subscriptions.status} in ('past_due', 'halted') and ${subscriptions.graceEndsAt} is not null and ${subscriptions.graceEndsAt} > ${ts(now)})
    or (${subscriptions.status} = 'cancelled' and ${subscriptions.currentPeriodEnd} is not null and ${subscriptions.currentPeriodEnd} > ${ts(now)})
  )`;
}

export class PostgresAdminBillingReader implements AdminBillingReader {
  constructor(private readonly db: Database) {}

  async allSubscriptions(): Promise<SubscriptionReadRow[]> {
    const rows = await this.db
      .select({
        workspaceId: subscriptions.workspaceId,
        workspaceName: workspaces.name,
        planKey: subscriptions.planKey,
        interval: subscriptions.interval,
        status: subscriptions.status,
        currentPeriodEnd: subscriptions.currentPeriodEnd,
        cancelAtPeriodEnd: subscriptions.cancelAtPeriodEnd,
        graceEndsAt: subscriptions.graceEndsAt,
        updatedAt: subscriptions.updatedAt,
      })
      .from(subscriptions)
      .innerJoin(workspaces, eq(workspaces.id, subscriptions.workspaceId))
      .orderBy(desc(subscriptions.updatedAt));
    return rows as SubscriptionReadRow[];
  }

  async workspaceEvents(workspaceId: string): Promise<BillingEventReadRow[]> {
    const rows = await this.db
      .select({
        id: billingEvents.id,
        provider: billingEvents.provider,
        providerEventId: billingEvents.providerEventId,
        eventType: billingEvents.eventType,
        receivedAt: billingEvents.receivedAt,
        processedAt: billingEvents.processedAt,
      })
      .from(billingEvents)
      .where(eq(billingEvents.workspaceId, workspaceId))
      .orderBy(desc(billingEvents.receivedAt));
    return rows as BillingEventReadRow[];
  }

  async entitledSubscriptionAmounts(now: Date): Promise<ActiveSubscriptionAmount[]> {
    // The latest captured payment per subscription, via a lateral-free
    // correlated subquery on provider_subscription_id. One row per entitled
    // subscription; latestCapturedAmount is null when none has been captured.
    const latestAmount = sql<string | null>`(
      select p.amount from ${payments} p
      where p.provider_subscription_id = ${subscriptions.providerSubscriptionId}
        and p.status = 'captured'
      order by p.created_at desc
      limit 1
    )`;
    const latestCurrency = sql<string | null>`(
      select p.currency from ${payments} p
      where p.provider_subscription_id = ${subscriptions.providerSubscriptionId}
        and p.status = 'captured'
      order by p.created_at desc
      limit 1
    )`;
    const rows = await this.db
      .select({
        workspaceId: subscriptions.workspaceId,
        planKey: subscriptions.planKey,
        interval: subscriptions.interval,
        latestCapturedAmount: latestAmount,
        currency: latestCurrency,
      })
      .from(subscriptions)
      .where(entitledAt(now));
    return rows as ActiveSubscriptionAmount[];
  }

  async churnedInWindow(start: Date, end: Date): Promise<number> {
    // A subscription that is now in a non-entitled terminal state and whose
    // last update landed in the window. expired/completed are unambiguous
    // churn; a cancelled row counts only once its period end has passed (it was
    // entitled until then), and a halted row once its grace has lapsed.
    const [row] = await this.db
      .select({ n: sql<number>`count(*)::int` })
      .from(subscriptions)
      .where(
        and(
          gte(subscriptions.updatedAt, start),
          lt(subscriptions.updatedAt, end),
          sql`(
            ${subscriptions.status} in ('expired', 'completed')
            or (${subscriptions.status} = 'cancelled' and (${subscriptions.currentPeriodEnd} is null or ${subscriptions.currentPeriodEnd} <= ${ts(end)}))
            or (${subscriptions.status} in ('past_due', 'halted') and (${subscriptions.graceEndsAt} is null or ${subscriptions.graceEndsAt} <= ${ts(end)}))
          )`,
        ),
      );
    return row?.n ?? 0;
  }

  async entitledCountAt(now: Date): Promise<number> {
    const [row] = await this.db
      .select({ n: sql<number>`count(*)::int` })
      .from(subscriptions)
      .where(entitledAt(now));
    return row?.n ?? 0;
  }

  async failedPaymentsInWindow(start: Date, end: Date): Promise<number> {
    const [row] = await this.db
      .select({ n: sql<number>`count(*)::int` })
      .from(payments)
      .where(and(eq(payments.status, "failed"), gte(payments.createdAt, start), lt(payments.createdAt, end)));
    return row?.n ?? 0;
  }

  async inGraceCount(now: Date): Promise<number> {
    const [row] = await this.db
      .select({ n: sql<number>`count(*)::int` })
      .from(subscriptions)
      .where(
        and(
          sql`${subscriptions.status} in ('past_due', 'halted')`,
          sql`${subscriptions.graceEndsAt} is not null`,
          sql`${subscriptions.graceEndsAt} > ${ts(now)}`,
        ),
      );
    return row?.n ?? 0;
  }
}
