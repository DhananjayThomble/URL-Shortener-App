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
import { users, workspaces } from "./identity.js";

/* ============================================================
   #992 — plan-management (billing 6/6, epic #991).

   The SaaS plan-change tooling on top of billing core (#986) and the plans
   engine (#970): admin/self-serve upgrades and downgrades (now or at period
   end, charged-prorated or comped), and a per-workspace timeline of every plan
   change, payment, refund and comp.

   PR-A adds two tables:

   - workspace_plan_history : an append-only timeline. One row per event in a
                      workspace's billing life — a plan change (admin or
                      self-serve), a comp grant, a comp expiry/revert, a payment,
                      a refund, a cancellation. The admin panel and the owner's
                      billing page both read it. Append-only by discipline, like
                      the admin audit log: nothing updates or deletes a row.

   - plan_change_requests : a SCHEDULED change that has not taken effect yet — a
                      downgrade (or admin change) set for the end of the current
                      period, or a comp that reverts on a date. A background
                      sweep applies a row once its effectiveAt passes, then marks
                      it applied. An immediate change writes history directly and
                      needs no row here.

   Coupons, trials and billing details are later parts of #992 (PR-B / PR-C) and
   add their own tables; these two are the foundation the plan-change flow and
   the history view are built on.
   ============================================================ */

/** UUIDv7: time-ordered and unguessable, the same id strategy as every table. */
const id = () => uuid("id").primaryKey().default(sql`uuidv7()`);

/** The kinds of event the timeline records. A fixed vocabulary (validated
 *  against PlanHistoryKind in the contract on write) so the UI can group and
 *  label rows without parsing free text. */
export const workspacePlanHistory = pgTable(
  "workspace_plan_history",
  {
    id: id(),
    workspaceId: uuid("workspace_id")
      .notNull()
      .references(() => workspaces.id, { onDelete: "cascade" }),

    /** "plan_change" | "comp_grant" | "comp_revert" | "payment" | "refund" |
     *  "cancellation" | "trial_start" | "trial_convert" | "trial_revert". A
     *  plain varchar validated by the contract on write. */
    kind: varchar("kind", { length: 24 }).notNull(),

    /** The plan key the workspace moved FROM, or null when there is no "from"
     *  (e.g. a payment row, or the first assignment). */
    fromPlanKey: varchar("from_plan_key", { length: 40 }),
    /** The plan key the workspace moved TO, or null for a non-change event. */
    toPlanKey: varchar("to_plan_key", { length: 40 }),

    /** For a change: "immediate" | "period_end". Null for a non-change event. */
    timing: varchar("timing", { length: 12 }),
    /** For an admin immediate change: "charge" | "comp". Null otherwise. */
    settlement: varchar("settlement", { length: 8 }),

    /** The signed minor-unit amount this event settled (a prorated charge is
     *  positive, a credit/refund negative, a comp 0). Null when the event has no
     *  money (a trial start). Stored as text to keep an exact integer with no
     *  float, same as payments.amount. */
    amountMinor: text("amount_minor"),
    /** The currency of amountMinor, or null when there is no amount. */
    currency: varchar("currency", { length: 3 }),

    /** The reason captured for a plan change or cancellation — required by the
     *  issue for admin changes and cancellations. Free text, nullable for events
     *  that carry no reason (a payment). */
    reason: text("reason"),

    /** Who caused the event: an admin's user id for an admin action, the owner's
     *  for a self-serve one, or null for a system/provider event (a webhook
     *  payment, a scheduled revert). SET NULL on user delete so the row
     *  survives; the label preserves who it was. */
    actorId: uuid("actor_id").references(() => users.id, { onDelete: "set null" }),
    actorLabel: varchar("actor_label", { length: 255 }),

    /** Freeform structured detail for the UI (the proration breakdown, the
     *  provider payment id, the comp end date). jsonb so the timeline can show
     *  rich context without a column per event kind. */
    metadata: jsonb("metadata"),

    /** When the event actually took effect. For an immediate change this is the
     *  write time; for an applied scheduled change it is the period end it fired
     *  on. Separate from createdAt (when the ROW was written) so a scheduled
     *  change recorded early reads correctly on the timeline. */
    effectiveAt: timestamp("effective_at", { withTimezone: true }).notNull().defaultNow(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index("workspace_plan_history_workspace_idx").on(t.workspaceId, t.createdAt),
  ],
);

export const planChangeRequests = pgTable(
  "plan_change_requests",
  {
    id: id(),
    workspaceId: uuid("workspace_id")
      .notNull()
      .references(() => workspaces.id, { onDelete: "cascade" }),

    /** The plan the workspace is on when the request is created (for the history
     *  row written when it applies). */
    fromPlanKey: varchar("from_plan_key", { length: 40 }),
    /** The plan to move TO when the request fires. */
    toPlanKey: varchar("to_plan_key", { length: 40 }).notNull(),

    /** "period_end" for a scheduled change; "comp_revert" for the reversion of a
     *  comp when its end date passes. Both fire from the same sweep. */
    kind: varchar("kind", { length: 16 }).notNull(),

    /** The reason captured when the change was requested (shown in history when
     *  it applies). */
    reason: text("reason"),

    /** Who scheduled it — an admin or the owner — for the eventual history row. */
    actorId: uuid("actor_id").references(() => users.id, { onDelete: "set null" }),
    actorLabel: varchar("actor_label", { length: 255 }),

    /** When this request becomes due. The sweep applies a row once now ≥ this. */
    effectiveAt: timestamp("effective_at", { withTimezone: true }).notNull(),

    /** When the sweep applied it, or null while still pending. A unique partial
     *  index below keeps at most ONE pending request per (workspace, kind) so a
     *  re-scheduled change replaces rather than stacks. */
    appliedAt: timestamp("applied_at", { withTimezone: true }),

    /** Structured detail carried to the history row when applied (e.g. the comp
     *  that is reverting, the interval). */
    metadata: jsonb("metadata"),

    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    /* Due pending requests, in effective order — the sweep's read. */
    index("plan_change_requests_due_idx").on(t.appliedAt, t.effectiveAt),
    index("plan_change_requests_workspace_idx").on(t.workspaceId),
    /* At most one PENDING request per (workspace, kind): scheduling a new
       period-end change for a workspace replaces the pending one rather than
       leaving two to both fire. Partial on appliedAt IS NULL so applied rows
       (history) are unconstrained. */
    uniqueIndex("plan_change_requests_pending_key")
      .on(t.workspaceId, t.kind)
      .where(sql`${t.appliedAt} is null`),
  ],
);

export const workspacePlanHistoryRelations = relations(workspacePlanHistory, ({ one }) => ({
  workspace: one(workspaces, { fields: [workspacePlanHistory.workspaceId], references: [workspaces.id] }),
}));

export const planChangeRequestsRelations = relations(planChangeRequests, ({ one }) => ({
  workspace: one(workspaces, { fields: [planChangeRequests.workspaceId], references: [workspaces.id] }),
}));
