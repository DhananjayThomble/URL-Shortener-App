import {
  index,
  integer,
  pgTable,
  timestamp,
  uniqueIndex,
  uuid,
  varchar,
} from "drizzle-orm/pg-core";
import { relations, sql } from "drizzle-orm";
import { users, workspaces } from "./identity.js";

/* ============================================================
   #992 — coupons (billing 6/6, epic #991).

   A coupon is a discount an admin creates and a workspace redeems at checkout.
   The DISCOUNT ITSELF is applied by the billing provider (the money math lives
   with the provider, same rule as prices): SnapURL validates the coupon against
   its own rules (expiry, max redemptions, plan/interval restrictions, paused),
   records the redemption, and passes the coupon's provider offer id to the
   provider as the subscription's offer. The plan still only becomes entitled on
   the verified webhook; a coupon never grants a plan on its own.

   Two tables:
   - coupons            : the admin-managed catalogue. One row per code.
   - coupon_redemptions : one row per (coupon, workspace) redemption, so
                          max_redemptions and "admin sees redemptions" are exact
                          counts of real rows, and a workspace cannot redeem the
                          same coupon twice.
   ============================================================ */

/** UUIDv7: time-ordered and unguessable, the same id strategy as every table. */
const id = () => uuid("id").primaryKey().default(sql`uuidv7()`);

export const coupons = pgTable(
  "coupons",
  {
    id: id(),
    /** The code a customer enters, unique case-insensitively. Stored as entered
     *  (display), matched lower-cased via the unique index below. */
    code: varchar("code", { length: 40 }).notNull(),

    /** "percent" — `value` is a whole-percent off (1..100). "fixed" — `value` is
     *  a minor-unit amount off (paise/cents) in `currency`. Validated by the
     *  service against CouponType. */
    kind: varchar("kind", { length: 8 }).notNull(),
    /** For percent: 1..100. For fixed: a non-negative minor-unit amount. */
    value: integer("value").notNull(),
    /** For a fixed coupon, the currency its `value` is in; null for percent
     *  (percent is currency-agnostic). */
    currency: varchar("currency", { length: 3 }),

    /** How long the discount lasts once redeemed: "once" (one billing period),
     *  "repeating" (durationMonths months), or "forever". */
    duration: varchar("duration", { length: 10 }).notNull(),
    /** For a "repeating" duration, how many months the discount applies; null
     *  for once/forever. */
    durationMonths: integer("duration_months"),

    /** When the coupon can no longer be redeemed, or null for no expiry. An
     *  already-redeemed discount keeps running per its duration; this only gates
     *  NEW redemptions. */
    expiresAt: timestamp("expires_at", { withTimezone: true }),
    /** The most times this coupon may be redeemed across all workspaces, or null
     *  for unlimited. Enforced against the live count of coupon_redemptions rows. */
    maxRedemptions: integer("max_redemptions"),

    /** When set, the coupon is paused: it stays in the catalogue and its past
     *  redemptions keep running, but no new redemption is allowed. Null = active. */
    pausedAt: timestamp("paused_at", { withTimezone: true }),

    /** Restrict the coupon to certain plan keys (comma-separated, lower-cased),
     *  or null for any plan. Stored as text, parsed by the service. */
    restrictPlanKeys: varchar("restrict_plan_keys", { length: 255 }),
    /** Restrict to "monthly" | "yearly", or null for any interval. */
    restrictInterval: varchar("restrict_interval", { length: 10 }),

    /** The provider's offer/coupon id this maps to, so a redemption passes the
     *  provider the right offer. Null until synced; a coupon with no provider
     *  offer still validates + records locally (the provider applies no discount
     *  then, which the admin sees). */
    providerOfferId: varchar("provider_offer_id", { length: 255 }),

    /** The admin who created it (SET NULL on user delete; label preserved). */
    createdById: uuid("created_by_id").references(() => users.id, { onDelete: "set null" }),
    createdByLabel: varchar("created_by_label", { length: 255 }),

    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [uniqueIndex("coupons_code_key").on(sql`lower(${t.code})`)],
);

export const couponRedemptions = pgTable(
  "coupon_redemptions",
  {
    id: id(),
    couponId: uuid("coupon_id")
      .notNull()
      .references(() => coupons.id, { onDelete: "cascade" }),
    workspaceId: uuid("workspace_id")
      .notNull()
      .references(() => workspaces.id, { onDelete: "cascade" }),
    /** The plan key + interval the coupon was redeemed against, for the admin
     *  redemptions view. */
    planKey: varchar("plan_key", { length: 40 }).notNull(),
    interval: varchar("interval", { length: 10 }).notNull(),
    redeemedAt: timestamp("redeemed_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    /* One redemption per (coupon, workspace): a workspace cannot redeem the same
       coupon twice, and the admin redemptions count is a count of real rows. */
    uniqueIndex("coupon_redemptions_coupon_workspace_key").on(t.couponId, t.workspaceId),
    index("coupon_redemptions_coupon_idx").on(t.couponId),
  ],
);

export const couponsRelations = relations(coupons, ({ many }) => ({
  redemptions: many(couponRedemptions),
}));

export const couponRedemptionsRelations = relations(couponRedemptions, ({ one }) => ({
  coupon: one(coupons, { fields: [couponRedemptions.couponId], references: [coupons.id] }),
  workspace: one(workspaces, { fields: [couponRedemptions.workspaceId], references: [workspaces.id] }),
}));
