import {
  index,
  jsonb,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
  varchar,
} from "drizzle-orm/pg-core";
import { relations, sql } from "drizzle-orm";
import { workspaces } from "./identity.js";

/* ============================================================
   #986 — billing core (epic #991), Razorpay in test mode.

   Three append-or-update tables, all additive:

   - subscriptions  : one workspace's current paid plan + lifecycle. A plan is
                      named by KEY (starter/pro/team), never by a price or a
                      provider price id, so this does not block on #970's
                      editable plans or #987's editable prices.
   - billing_events : every webhook event the API VERIFIED, stored raw. The
                      provider event id is unique here, which is what makes
                      processing idempotent: a replay of an already-seen event
                      hits the unique index and changes nothing.
   - payments       : individual charges/invoices, for a receipt history. Not
                      the source of entitlement — the subscription row is.

   A workspace's plan ONLY ever moves because a verified webhook wrote one of
   these rows. The browser's "payment succeeded" redirect writes nothing.
   ============================================================ */

/** UUIDv7: time-ordered and unguessable, the same id strategy as every table. */
const id = () => uuid("id").primaryKey().default(sql`uuidv7()`);

export const subscriptions = pgTable(
  "subscriptions",
  {
    id: id(),
    workspaceId: uuid("workspace_id")
      .notNull()
      .references(() => workspaces.id, { onDelete: "cascade" }),

    /** The plan KEY (free/starter/pro/team). Free rows are not stored — a
     *  workspace with no subscription row is implicitly on free — so in
     *  practice this is a paid key, but the column is a plain varchar so the
     *  #970 editable-plans work can widen the catalogue without a type change. */
    planKey: varchar("plan_key", { length: 40 }).notNull(),
    /** "monthly" | "yearly". */
    interval: varchar("interval", { length: 10 }).notNull(),

    /** Which provider owns this subscription ("razorpay"). Kept so a later
     *  Stripe adapter can coexist without a migration. */
    provider: varchar("provider", { length: 20 }).notNull(),
    /** The provider's subscription id (Razorpay sub_...). Unique per provider
     *  so an incoming webhook can resolve the workspace from it. */
    providerSubscriptionId: varchar("provider_subscription_id", { length: 255 }),
    /** The provider's customer id, when the provider issues one. */
    providerCustomerId: varchar("provider_customer_id", { length: 255 }),

    /** Lifecycle, mirroring SUBSCRIPTION_STATUSES in the contract. */
    status: varchar("status", { length: 20 }).notNull(),
    /** End of the paid period the workspace is currently entitled through. */
    currentPeriodEnd: timestamp("current_period_end", { withTimezone: true }),
    /** When set, a cancellation is scheduled: the plan stays active until
     *  currentPeriodEnd, then lapses to free. */
    cancelAtPeriodEnd: timestamp("cancel_at_period_end", { withTimezone: true }),

    /* ── Forward-compat columns for the later SaaS plan-management work. Added
         now, nullable and unused in #986, so #992 / #970 extend behaviour
         without a schema migration. #986 writes none of them. ── */
    /** #992 — end of a free trial, or null when there is no trial. A trialing
     *  subscription is entitled until this instant even before the first
     *  charge. Unused in #986 (no trials here). */
    trialEndsAt: timestamp("trial_ends_at", { withTimezone: true }),
    /** #992 — an applied offer/coupon/discount id at the provider, or null when
     *  the subscription is at list price. A plain id, not a FK: the offer lives
     *  at the provider (or in a later offers table), so this must not cascade.
     *  Unused in #986 (no coupons here). */
    offerId: varchar("offer_id", { length: 255 }),
    /** #970 — which versioned plan (feature matrix) this subscription is on.
     *  Null for now: plans are referenced by key in #986 and versioning does
     *  not exist yet. A plain uuid, not a FK, until #970 creates the table it
     *  would reference — so adding that table later is additive, not a change
     *  to this column. */
    planVersionId: uuid("plan_version_id"),

    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    /* One current subscription row per workspace: the plan a workspace is on is
       a single fact, and the webhook handler upserts on it. */
    uniqueIndex("subscriptions_workspace_key").on(t.workspaceId),
    /* Resolve the workspace from a webhook's subscription id. Unique so two
       workspaces can never claim the same provider subscription; partial
       because a locally-created row may not have the provider id yet. */
    uniqueIndex("subscriptions_provider_sub_key")
      .on(t.providerSubscriptionId)
      .where(sql`${t.providerSubscriptionId} is not null`),
  ],
);

export const billingEvents = pgTable(
  "billing_events",
  {
    id: id(),
    /** The provider's event id (Razorpay delivers x-razorpay-event-id). UNIQUE
     *  — this is the idempotency key: a replayed webhook with the same id is
     *  refused by the index and processed exactly once. */
    providerEventId: varchar("provider_event_id", { length: 255 }).notNull(),
    provider: varchar("provider", { length: 20 }).notNull(),
    /** The event type as the provider names it, e.g. "subscription.charged". */
    eventType: varchar("event_type", { length: 80 }).notNull(),
    /** The workspace the event resolved to, when it could be resolved. Null for
     *  an event about a subscription this instance has no row for (stored for
     *  the record, acted on by nothing). */
    workspaceId: uuid("workspace_id").references(() => workspaces.id, { onDelete: "set null" }),
    /** The full verified event body, exactly as received (after signature
     *  verification). The raw record, never re-derived. */
    payload: jsonb("payload").notNull(),
    /** When the handler finished acting on the event, or null while a stored
     *  event is awaiting processing. */
    processedAt: timestamp("processed_at", { withTimezone: true }),
    receivedAt: timestamp("received_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex("billing_events_provider_event_key").on(t.provider, t.providerEventId),
    index("billing_events_workspace_idx").on(t.workspaceId),
  ],
);

export const payments = pgTable(
  "payments",
  {
    id: id(),
    workspaceId: uuid("workspace_id")
      .notNull()
      .references(() => workspaces.id, { onDelete: "cascade" }),
    provider: varchar("provider", { length: 20 }).notNull(),
    /** The provider's payment id (Razorpay pay_...). Unique per provider. */
    providerPaymentId: varchar("provider_payment_id", { length: 255 }).notNull(),
    /** The subscription this payment settled, when it is for one. */
    providerSubscriptionId: varchar("provider_subscription_id", { length: 255 }),
    /** Smallest currency unit (paise for INR), as the provider reports it. An
     *  integer count of the minor unit, stored as text to avoid any float. */
    amount: text("amount").notNull(),
    currency: varchar("currency", { length: 3 }).notNull(),
    /** "captured" | "failed" | "refunded", as the provider names it. */
    status: varchar("status", { length: 20 }).notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex("payments_provider_payment_key").on(t.provider, t.providerPaymentId),
    index("payments_workspace_idx").on(t.workspaceId),
  ],
);

export const subscriptionsRelations = relations(subscriptions, ({ one }) => ({
  workspace: one(workspaces, { fields: [subscriptions.workspaceId], references: [workspaces.id] }),
}));

export const paymentsRelations = relations(payments, ({ one }) => ({
  workspace: one(workspaces, { fields: [payments.workspaceId], references: [workspaces.id] }),
}));
