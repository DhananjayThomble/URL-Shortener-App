import { boolean, index, integer, jsonb, pgTable, text, timestamp, uuid, varchar } from "drizzle-orm/pg-core";
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

/* ============================================================
   #972 — the platform-settings store (admin panel 5/7, epic #975).

   Settings an operator can change from the admin panel WITHOUT a redeploy:
   whether signups are open, the runtime rate-limit values, reserved slugs,
   feature switches and the site-wide banner. Deliberately NOT here: secrets,
   database and JWT config, and AWS infrastructure — those stay in
   SSM/Secrets Manager (issue #972, "out of scope on purpose").

   One row per setting KEY rather than a single wide row: every setting then
   carries its own "who changed it last, and when", which is exactly what the
   admin UI shows per setting, and a later part of the epic can add a new key
   with no migration. A key with no row means "never set" — the API falls back
   to the compiled-in default (and, for the rate limits, to the env values), so
   a fresh deploy behaves identically to before this table existed.

   The VALUE is jsonb, not a typed column, because the settings are a mix of
   shapes (an enum string, two integers, a string array, a map of booleans, a
   nullable string). The API validates every value against a per-key zod schema
   on write, so the jsonb only ever holds a shape the contract already blessed —
   the column is a container, the schema is the type.

   NOT append-only: a setting's current value lives in its row and is updated in
   place. The history of WHO changed WHAT to WHAT is the admin_audit_log above —
   every settings write records a before/after row there — so the store itself
   only needs the current value plus the last-writer stamp the UI reads.
   ============================================================ */

export const platformSettings = pgTable("platform_settings", {
  /** The setting key, e.g. "signup_mode" or "rate_limit". A short stable
   *  identifier the API maps to its per-key schema and default. */
  key: varchar("key", { length: 64 }).primaryKey(),
  /** The current value, validated against the key's schema before it is
   *  written. jsonb so one table holds every setting's shape. */
  value: jsonb("value").notNull(),
  /** The platform admin who last wrote this setting. SET NULL on user delete so
   *  the setting survives the admin who set it; the label preserves who it was. */
  updatedById: uuid("updated_by_id").references(() => users.id, { onDelete: "set null" }),
  /** That admin's email at write time, retained even if updatedById is nulled,
   *  so the UI's "last changed by" is never anonymous. */
  updatedByLabel: varchar("updated_by_label", { length: 255 }),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});


/* ============================================================
   #1020 — outbound-email rate accounting for the email.outbound kill switch.

   The email.outbound switch carries hourly and daily caps (platform-wide), and
   auth-critical mail (verification, password reset) may bypass the OFF switch
   but is STILL counted and refused past the caps. Nothing else in the schema
   records outbound-email volume, so this tiny append-only ledger does: one row
   per message actually sent, carrying only the send instant and whether it was
   an auth-critical (bypass-eligible) send. The cap check counts rows in the
   trailing hour / day before a send; the row is written when a send is allowed.

   Deliberately minimal — NO recipient, subject or body. A cap is a count, so
   the ledger needs only the timestamps; keeping PII out of it means the table
   can be read by the admin panel and pruned freely without a privacy concern.
   Pruned by the hourly maintenance job (rows older than the longest window are
   dead weight). Platform-scoped, so it lives here beside the other admin tables
   rather than in a workspace-scoped file.
   ============================================================ */
export const emailSendLog = pgTable(
  "email_send_log",
  {
    id: id(),
    /** When the message was sent. The only thing the rolling-window cap reads. */
    sentAt: timestamp("sent_at", { withTimezone: true }).notNull().defaultNow(),
    /** True for auth-critical mail (verification / password reset): it bypasses
     *  the email.outbound OFF switch but is still counted here and capped. */
    authCritical: boolean("auth_critical").notNull().default(false),
  },
  (t) => [
    // The cap counts rows newer than a cutoff, so index sent_at descending.
    index("email_send_log_sent_at_idx").on(t.sentAt.desc()),
  ],
);

/* ============================================================
   #1032 — the kill-switch REFUSAL aggregation window.

   Every kill-switch refusal (a switched-off 503 or a cap-reached 403, on an API
   route or in a worker job) records a row on admin_audit_log. A kill switch is
   thrown at an abuse wave, and an abuse wave fires the most refusals — so one
   audit row per refusal would let the very flood the switch is holding back
   flood the audit table instead. This tiny table is the dedupe ledger that
   stops that: ONE row per (switch, reason, subject) per minute, carrying a
   COUNT of how many refusals it stands for.

   The dedupe key is a deterministic string (see killSwitchRefusalDedupeKey in
   @snapurl/contract) carrying the switch, the reason, the subject (workspace,
   else actor, else "anon") and the minute bucket. An INSERT ... ON CONFLICT on
   the key either creates the row (count 1 — the writer then appends the single
   admin_audit_log row for the window) or bumps `count` and `last_at` and writes
   NO audit row. The whole table is a rolling aggregation window, pruned by the
   hourly maintenance job once a window is well past; nothing reads it except
   the upsert and the pruner, so it never carries PII — only ids, the switch,
   the reason and a count.
   ============================================================ */
export const killSwitchRefusalWindow = pgTable(
  "kill_switch_refusal_window",
  {
    id: id(),
    /** The deterministic (switch|reason|subject|windowStart) key. UNIQUE: the
     *  upsert conflicts on it to collapse a window to one row. */
    dedupeKey: varchar("dedupe_key", { length: 320 }).notNull().unique(),
    /** The switch key refused (e.g. "billing.checkout"). */
    switchKey: varchar("switch_key", { length: 64 }).notNull(),
    /** The stable reason code: "feature_off" or "cap_reached". */
    reason: varchar("reason", { length: 24 }).notNull(),
    /** The workspace the refusal was attributed to, when known. */
    workspaceId: uuid("workspace_id"),
    /** The acting user id, when a request carried one. */
    actorId: uuid("actor_id"),
    /** How many refusals this window row stands for (>= 1). */
    count: integer("count").notNull().default(1),
    /** When the window opened (its first refusal). */
    firstAt: timestamp("first_at", { withTimezone: true }).notNull().defaultNow(),
    /** When the most recent refusal in this window landed. */
    lastAt: timestamp("last_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    // Pruned by a trailing cutoff on first_at, so index it ascending for the
    // range delete the maintenance job runs.
    index("kill_switch_refusal_window_first_at_idx").on(t.firstAt),
  ],
);
