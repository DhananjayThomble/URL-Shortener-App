import {
  bigint,
  boolean,
  date,
  index,
  integer,
  pgTable,
  primaryKey,
  text,
  timestamp,
  uniqueIndex,
  uuid,
  varchar,
} from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";
import { workspaces } from "./identity.js";
import { links } from "./links.js";

const id = () => uuid("id").primaryKey().default(sql`uuidv7()`);

/* ============================================================
   Click ingest and the rollups the dashboards actually read.

   Note what is NOT here: there is no ip column. The raw address
   exists in memory for the length of one request, goes into the
   daily-salted HMAC, and is discarded. The promise on the landing
   page is only as good as the absence of that column.
   ============================================================ */

export const clickEvents = pgTable(
  "click_events",
  {
    id: id(),
    linkId: uuid("link_id")
      .notNull()
      .references(() => links.id, { onDelete: "cascade" }),
    workspaceId: uuid("workspace_id")
      .notNull()
      .references(() => workspaces.id, { onDelete: "cascade" }),

    occurredAt: timestamp("occurred_at", { withTimezone: true }).notNull(),

    /** HMAC(daily salt, ip ‖ ua ‖ link_id). Not reversible once the salt rotates. */
    visitorHash: varchar("visitor_hash", { length: 32 }).notNull(),

    country: varchar("country", { length: 2 }),
    /* Resolved by CloudFront at the edge and handed to us as a name, so no IP
       is ever seen here for geolocation and none is stored. The city name and
       nothing finer — never the latitude/longitude the same header family
       offers. See docs/DECISIONS.md. */
    city: varchar("city", { length: 100 }),
    device: varchar("device", { length: 10 }),
    browser: varchar("browser", { length: 40 }),
    os: varchar("os", { length: 20 }),
    /** Host only. The full referrer path can carry PII we have no business storing. */
    referrerHost: varchar("referrer_host", { length: 253 }),

    isQr: boolean("is_qr").notNull().default(false),
    /** Stored rather than filtered at ingest, so improving bot detection later
     *  is an UPDATE instead of a re-ingest of data we no longer have. */
    isBot: boolean("is_bot").notNull().default(false),

    /** Set when the click was refused: "expired", "click_limit", "flagged". */
    blockedReason: varchar("blocked_reason", { length: 30 }),

    matchedRuleId: uuid("matched_rule_id"),
    variant: varchar("variant", { length: 12 }),

    /** Set once the row has been folded into the rollups. The partial index
     *  below means "what still needs rolling up" is a cheap lookup however
     *  many hundreds of millions of rolled-up rows sit behind it. */
    rolledUpAt: timestamp("rolled_up_at", { withTimezone: true }),
  },
  (t) => [
    index("click_events_link_time_idx").on(t.linkId, t.occurredAt.desc()),
    index("click_events_workspace_time_idx").on(t.workspaceId, t.occurredAt.desc()),
    index("click_events_pending_idx").on(t.occurredAt).where(sql`${t.rolledUpAt} is null`),
  ],
);

/* The rollups.

   Without these, /analytics aggregates raw rows on every page load — fine at a
   thousand clicks, unusable at ten million. The dashboards read only these
   tables; click_events exists for export and for recomputing a rollup that
   went wrong. */

export const clickDaily = pgTable(
  "click_daily",
  {
    linkId: uuid("link_id")
      .notNull()
      .references(() => links.id, { onDelete: "cascade" }),
    workspaceId: uuid("workspace_id")
      .notNull()
      .references(() => workspaces.id, { onDelete: "cascade" }),
    day: date("day").notNull(),
    clicks: integer("clicks").notNull().default(0),
    uniques: integer("uniques").notNull().default(0),
    scans: integer("scans").notNull().default(0),
    blocked: integer("blocked").notNull().default(0),
  },
  (t) => [
    primaryKey({ columns: [t.linkId, t.day] }),
    index("click_daily_workspace_day_idx").on(t.workspaceId, t.day),
  ],
);

/** One table serves countries, devices, browsers, referrers and tags — the
 *  dashboard renders them identically, so storing them identically keeps the
 *  query and the rollup to one shape each. */
export const breakdownDaily = pgTable(
  "breakdown_daily",
  {
    workspaceId: uuid("workspace_id")
      .notNull()
      .references(() => workspaces.id, { onDelete: "cascade" }),
    linkId: uuid("link_id").references(() => links.id, { onDelete: "cascade" }),
    day: date("day").notNull(),
    dimension: varchar("dimension", { length: 16 }).notNull(),
    value: varchar("value", { length: 253 }).notNull(),
    count: integer("count").notNull().default(0),
  },
  (t) => [
    uniqueIndex("breakdown_daily_key").on(
      t.workspaceId,
      sql`coalesce(${t.linkId}, '00000000-0000-0000-0000-000000000000'::uuid)`,
      t.day,
      t.dimension,
      t.value,
    ),
    index("breakdown_daily_lookup_idx").on(t.workspaceId, t.dimension, t.day),
  ],
);

/** Counting distinct visitors per day needs the set of hashes seen that day.
 *  Kept separately from click_events so retention can drop the raw events
 *  while the uniques number stays correct. Pruned aggressively — it only has
 *  to survive long enough for the day to close. */
export const dailyVisitors = pgTable(
  "daily_visitors",
  {
    linkId: uuid("link_id")
      .notNull()
      .references(() => links.id, { onDelete: "cascade" }),
    day: date("day").notNull(),
    visitorHash: varchar("visitor_hash", { length: 32 }).notNull(),
  },
  (t) => [primaryKey({ columns: [t.linkId, t.day, t.visitorHash] })],
);

/** The rotating salt behind every visitor hash. Yesterday's row is deleted,
 *  which is what makes yesterday's hashes permanently un-recomputable. */
export const dailySalts = pgTable("daily_salts", {
  day: date("day").primaryKey(),
  salt: text("salt").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

/* G7 — revenue was a bare float with no unit.

   value_minor is an integer count of minor units: 1999 is ₹19.99, never
   19.99. Floats lose cents at scale, and a mixed-currency sum is a number
   that means nothing. */
export const conversions = pgTable(
  "conversions",
  {
    id: id(),
    workspaceId: uuid("workspace_id")
      .notNull()
      .references(() => workspaces.id, { onDelete: "cascade" }),
    linkId: uuid("link_id").references(() => links.id, { onDelete: "set null" }),

    kind: varchar("kind", { length: 12 }).notNull(),
    name: varchar("name", { length: 120 }).notNull(),
    source: varchar("source", { length: 120 }).notNull().default("api"),

    valueMinor: bigint("value_minor", { mode: "number" }).notNull().default(0),
    currency: varchar("currency", { length: 3 }).notNull().default("INR"),

    /** The caller's own id, so retries do not double-count a sale. */
    externalId: varchar("external_id", { length: 200 }),
    visitorHash: varchar("visitor_hash", { length: 32 }),

    occurredAt: timestamp("occurred_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index("conversions_workspace_time_idx").on(t.workspaceId, t.occurredAt.desc()),
    uniqueIndex("conversions_external_key")
      .on(t.workspaceId, t.externalId)
      .where(sql`${t.externalId} is not null`),
  ],
);
