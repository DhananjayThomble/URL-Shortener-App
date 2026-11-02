import {
  index,
  integer,
  jsonb,
  pgTable,
  timestamp,
  uniqueIndex,
  uuid,
  varchar,
} from "drizzle-orm/pg-core";
import { relations, sql } from "drizzle-orm";
import { users, workspaces } from "./identity.js";

/* ============================================================
   #970 — the DB-backed plans / entitlements engine (admin panel 3/7, epic #975).

   #966 put plan entitlements in a static table in @snapurl/contract. This makes
   them editable from the admin panel with no code change or redeploy, while
   keeping ONE place that decides what a plan may do. The shape is three tables
   plus a grandfathering pin on the workspace:

   - plans           : the catalogue. One row per plan KEY (free/starter/pro/
                       team/enterprise and whatever an admin adds). Visibility
                       controls whether it shows on /pricing (public), is
                       admin-assignable only (hidden), or is closed to new
                       sign-ups but kept for existing workspaces (archived).
                       `currentVersionId` points at the live feature/limit set.
   - plan_versions   : an immutable snapshot of a plan's feature matrix + limits.
                       Editing a live plan's features or limits creates a NEW
                       version and moves the plan's currentVersionId forward;
                       existing workspaces stay pinned to their old version
                       (grandfathering) until an admin migrates them.
   - workspace_plan_overrides : a single feature grant/removal or a raised limit
                       for ONE workspace (an enterprise deal), optionally until a
                       date. An override beats the plan; an expired one is
                       ignored. Each carries who set it, for the audit trail.

   The resolver (@snapurl/contract resolveEntitlements) folds version + overrides
   into the effective entitlements. An unknown / unrecognised plan resolves to
   `free` — fail closed, never a silent paid grant (this is the one behaviour
   #970 changes from #966, where an unknown name counted as paid).

   Every admin write to any of these goes through writeAdminAuditEntry with the
   before/after state, exactly like platform_settings, so the admin audit log
   records every plan change.
   ============================================================ */

/** UUIDv7: time-ordered and unguessable, the same id strategy as every table. */
const id = () => uuid("id").primaryKey().default(sql`uuidv7()`);

export const plans = pgTable(
  "plans",
  {
    id: id(),
    /** The stable plan key (free/starter/pro/team/enterprise, …). Billing (#986)
     *  and workspaces.plan refer to a plan by this key, case-insensitively, so it
     *  is the join point for the whole system. Lower-cased by the service on
     *  write; unique so two plans can never share a key. */
    key: varchar("key", { length: 40 }).notNull(),
    /** The human name shown on /pricing and in the admin grid. */
    displayName: varchar("display_name", { length: 80 }).notNull(),
    /** A one-line description for the pricing card. Empty string, not null, so
     *  the public read never has to coalesce. */
    description: varchar("description", { length: 280 }).notNull().default(""),
    /** An optional highlight badge ("Most popular"), or null for none. */
    highlightBadge: varchar("highlight_badge", { length: 40 }),
    /** Sort order on /pricing and in the admin list, ascending. */
    sortOrder: integer("sort_order").notNull().default(0),
    /**
     * public  — shown on /pricing, anyone can sign up for it.
     * hidden  — not on /pricing, assignable only by an admin (custom deals).
     * archived — closed to new sign-ups; existing workspaces keep it.
     * A plain varchar, validated against PlanVisibility on write.
     */
    visibility: varchar("visibility", { length: 10 }).notNull().default("public"),
    /** The live version an unpinned workspace on this plan resolves to. Nullable
     *  only during the instant between inserting a plan and its first version; a
     *  plain uuid (not an FK) so creating the first version is a plain update and
     *  dropping a version never cascades the plan away. */
    currentVersionId: uuid("current_version_id"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [uniqueIndex("plans_key_key").on(sql`lower(${t.key})`)],
);

export const planVersions = pgTable(
  "plan_versions",
  {
    id: id(),
    planId: uuid("plan_id")
      .notNull()
      .references(() => plans.id, { onDelete: "cascade" }),
    /** Monotonic per plan, starting at 1. A workspace grandfathered on version 2
     *  keeps resolving against this row even after the plan moves to version 3. */
    version: integer("version").notNull(),
    /**
     * The feature matrix: a map of entitlement name -> boolean. A feature absent
     * from the map is treated as off, so adding a new entitlement name later
     * defaults every existing version to "not included" until an admin turns it
     * on — fail closed. Validated against FeatureMatrix on write.
     */
    features: jsonb("features").notNull(),
    /**
     * The limits: a map of limit name -> number, or null for "unlimited". A limit
     * absent from the map means 0 (nothing allowed) so a forgotten limit fails
     * closed rather than granting an unbounded amount. Validated against
     * LimitMatrix on write.
     */
    limits: jsonb("limits").notNull(),
    /** Left for #987 (admin-editable prices): a version can carry its price set
     *  later. Null here; #970 builds no pricing. jsonb so #987 is additive. */
    pricing: jsonb("pricing"),
    /* NOTE (#986 ↔ #970): billing's `subscriptions.plan_version_id` (schema/
       billing.ts) is a nullable, un-FK'd uuid that points at THIS table's `id`.
       It is deliberately left loose (not a foreign key) and is written null by
       #986. TODO(#987): when admin-editable prices land, populate it with the
       version a subscription was created against and decide whether to promote
       it to a real FK — kept additive here so #986's merged migration is not
       disturbed. */
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [uniqueIndex("plan_versions_plan_version_key").on(t.planId, t.version)],
);

export const workspacePlanOverrides = pgTable(
  "workspace_plan_overrides",
  {
    id: id(),
    workspaceId: uuid("workspace_id")
      .notNull()
      .references(() => workspaces.id, { onDelete: "cascade" }),
    /** "feature" — grant or remove a single entitlement. "limit" — raise or set a
     *  single limit. Validated against OverrideKind on write. */
    kind: varchar("kind", { length: 10 }).notNull(),
    /** The entitlement or limit name this override targets. */
    name: varchar("name", { length: 40 }).notNull(),
    /**
     * For a feature override, a boolean (grant true / remove false). For a limit
     * override, a number or null (null = unlimited). jsonb so one column holds
     * both shapes; validated by kind on write.
     */
    value: jsonb("value").notNull(),
    /** When the override stops applying, or null for no expiry. An override past
     *  its expiry is ignored by the resolver — the plan value stands again. */
    expiresAt: timestamp("expires_at", { withTimezone: true }),
    /** The platform admin who set this override. SET NULL on user delete so the
     *  override survives the admin who set it; the label preserves who it was. */
    createdById: uuid("created_by_id").references(() => users.id, { onDelete: "set null" }),
    createdByLabel: varchar("created_by_label", { length: 255 }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    /* One active override per (workspace, kind, name): setting an override for a
       feature/limit a workspace already has replaces it rather than stacking. */
    uniqueIndex("workspace_plan_overrides_target_key").on(t.workspaceId, t.kind, t.name),
    index("workspace_plan_overrides_workspace_idx").on(t.workspaceId),
  ],
);

export const usageWarnings = pgTable(
  "usage_warnings",
  {
    id: id(),
    workspaceId: uuid("workspace_id")
      .notNull()
      .references(() => workspaces.id, { onDelete: "cascade" }),
    /** The limit this warning is about (a LimitName, e.g. "links"). */
    limitName: varchar("limit_name", { length: 40 }).notNull(),
    /**
     * The band the workspace is currently IN for this limit: "warn" (>=80%) or
     * "full" (>=100%). A row exists only while the workspace is at or above the
     * warn threshold; dropping back below it deletes the row. This IS the in-app
     * signal the Settings usage view reads, and it dedupes the owner email — an
     * email is sent only when the band crosses UP to a level not already
     * recorded, so an owner is warned once at 80% and once at 100%, not on every
     * usage read.
     */
    band: varchar("band", { length: 10 }).notNull(),
    /** When the current band was last notified by email, so a re-evaluation at
     *  the same band does not re-send. */
    notifiedAt: timestamp("notified_at", { withTimezone: true }),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [uniqueIndex("usage_warnings_workspace_limit_key").on(t.workspaceId, t.limitName)],
);

export const plansRelations = relations(plans, ({ many }) => ({
  versions: many(planVersions),
}));

export const planVersionsRelations = relations(planVersions, ({ one }) => ({
  plan: one(plans, { fields: [planVersions.planId], references: [plans.id] }),
}));

export const workspacePlanOverridesRelations = relations(workspacePlanOverrides, ({ one }) => ({
  workspace: one(workspaces, {
    fields: [workspacePlanOverrides.workspaceId],
    references: [workspaces.id],
  }),
}));
