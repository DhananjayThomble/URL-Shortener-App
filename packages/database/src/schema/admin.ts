import { index, jsonb, pgTable, text, timestamp, uuid, varchar } from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";
import { users } from "./identity.js";

/* ============================================================
   #968 — the platform-admin audit log (foundation for epic #975).

   This is NOT the workspace audit_log (schema/developers.ts). That one is
   workspace-scoped and records what a member did inside their own workspace.
   This one is PLATFORM-scoped: it records what a platform admin did acting on
   the whole platform, which is a different actor, a different blast radius and
   a different reader (an operator, not a workspace owner).

   Append-only by discipline: every write goes through writeAdminAuditEntry and
   nothing in the codebase updates or deletes a row. `before`/`after` capture
   the state a write changed, so an action can be reviewed and, if needed,
   reconstructed. The row is deliberately self-contained — it does not cascade
   from the actor's user row (ON DELETE SET NULL, not CASCADE), because deleting
   an admin must never erase the record of what they did.
   ============================================================ */

/** UUIDv7: time-ordered and unguessable, same id strategy as every other table. */
const id = () => uuid("id").primaryKey().default(sql`uuidv7()`);

export const adminAuditLog = pgTable(
  "admin_audit_log",
  {
    id: id(),
    /** The platform admin who performed the action. SET NULL on user delete so
     *  the audit row outlives the actor — the label preserves who it was. */
    actorId: uuid("actor_id").references(() => users.id, { onDelete: "set null" }),
    /** The actor's email at the time of the action; retained even if actorId is
     *  later nulled, so the trail is never anonymous. */
    actorLabel: varchar("actor_label", { length: 255 }).notNull(),
    /** A dotted action key, e.g. "admin.session.start". Free text rather than a
     *  closed union: later parts of the epic add their own actions, and an
     *  append-only platform log must accept a key written by an older or newer
     *  deploy without a migration. */
    action: varchar("action", { length: 80 }).notNull(),
    /** What kind of thing was acted on (e.g. "user", "workspace"), or null for a
     *  platform-level action with no single target. */
    targetType: varchar("target_type", { length: 40 }),
    /** The target's identifier. A plain string, not a uuid FK: the target may
     *  live in another table, or be a non-uuid handle, and the log must not
     *  cascade-delete when the target does. */
    targetId: varchar("target_id", { length: 255 }),
    /** The relevant state before the write, or null when there was none. */
    before: jsonb("before"),
    /** The relevant state after the write, or null when the write removed it. */
    after: jsonb("after"),
    /** The request's client IP, as the API resolved it. Nullable because some
     *  internal/background actions have no request behind them. */
    requestIp: text("request_ip"),
    at: timestamp("at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    /* Newest-first reads by actor and overall are the two the operator UI will
       make, so index the common ordering. */
    index("admin_audit_log_time_idx").on(t.at.desc()),
    index("admin_audit_log_actor_time_idx").on(t.actorId, t.at.desc()),
  ],
);
