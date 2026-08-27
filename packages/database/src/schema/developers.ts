import {
  index,
  integer,
  jsonb,
  pgTable,
  smallint,
  text,
  timestamp,
  uniqueIndex,
  uuid,
  varchar,
} from "drizzle-orm/pg-core";
import { relations, sql } from "drizzle-orm";
import { users, workspaces } from "./identity.js";
import { domains, links } from "./links.js";

const id = () => uuid("id").primaryKey().default(sql`uuidv7()`);

export const apiKeys = pgTable(
  "api_keys",
  {
    id: id(),
    workspaceId: uuid("workspace_id")
      .notNull()
      .references(() => workspaces.id, { onDelete: "cascade" }),
    name: varchar("name", { length: 60 }).notNull(),

    /* Stored hashed, exactly like a password — a leaked database should not
       hand over working API keys. The prefix is kept in the clear so the UI can
       show "snap_live_a1b2…c3d4" without being able to reconstruct the key. */
    keyHash: text("key_hash").notNull(),
    keyPrefix: varchar("key_prefix", { length: 20 }).notNull(),
    keyLast4: varchar("key_last4", { length: 4 }).notNull(),

    scopes: text("scopes").array().notNull().default(sql`ARRAY[]::text[]`),
    lastUsedAt: timestamp("last_used_at", { withTimezone: true }),
    revokedAt: timestamp("revoked_at", { withTimezone: true }),
    createdBy: uuid("created_by").references(() => users.id, { onDelete: "set null" }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex("api_keys_hash_key").on(t.keyHash),
    index("api_keys_workspace_idx").on(t.workspaceId),
  ],
);

export const webhooks = pgTable(
  "webhooks",
  {
    id: id(),
    workspaceId: uuid("workspace_id")
      .notNull()
      .references(() => workspaces.id, { onDelete: "cascade" }),
    endpoint: text("endpoint").notNull(),
    events: text("events").array().notNull().default(sql`ARRAY[]::text[]`),
    /** Signs the payload so the receiver can prove it came from us. */
    secret: text("secret").notNull(),

    /* Derived from recent deliveries rather than set by hand: healthy →
       retrying after the first failure → failing once the backoff is exhausted. */
    health: varchar("health", { length: 12 }).notNull().default("healthy"),
    consecutiveFailures: smallint("consecutive_failures").notNull().default(0),
    lastDeliveryAt: timestamp("last_delivery_at", { withTimezone: true }),
    lastError: text("last_error"),

    disabledAt: timestamp("disabled_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("webhooks_workspace_idx").on(t.workspaceId)],
);

export const webhookDeliveries = pgTable(
  "webhook_deliveries",
  {
    id: id(),
    webhookId: uuid("webhook_id")
      .notNull()
      .references(() => webhooks.id, { onDelete: "cascade" }),
    event: varchar("event", { length: 40 }).notNull(),
    payload: jsonb("payload").notNull(),

    status: varchar("status", { length: 12 }).notNull().default("pending"),
    attempts: smallint("attempts").notNull().default(0),
    responseCode: integer("response_code"),
    error: text("error"),
    /** Exponential backoff: 1m, 5m, 25m, 2h, 10h, then give up. */
    nextRetryAt: timestamp("next_retry_at", { withTimezone: true }),
    deliveredAt: timestamp("delivered_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index("webhook_deliveries_pending_idx")
      .on(t.nextRetryAt)
      .where(sql`${t.status} = 'pending'`),
    index("webhook_deliveries_webhook_idx").on(t.webhookId, t.createdAt.desc()),
  ],
);

export const bioPages = pgTable(
  "bio_pages",
  {
    id: id(),
    workspaceId: uuid("workspace_id")
      .notNull()
      .references(() => workspaces.id, { onDelete: "cascade" }),
    domainId: uuid("domain_id")
      .notNull()
      .references(() => domains.id, { onDelete: "restrict" }),
    slug: varchar("slug", { length: 64 }).notNull(),
    status: varchar("status", { length: 10 }).notNull().default("draft"),

    profileName: varchar("profile_name", { length: 80 }).notNull(),
    profileBio: varchar("profile_bio", { length: 280 }).notNull().default(""),

    views: integer("views").notNull().default(0),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [uniqueIndex("bio_pages_domain_slug_key").on(t.domainId, sql`lower(${t.slug})`)],
);

export const bioBlocks = pgTable(
  "bio_blocks",
  {
    id: id(),
    bioPageId: uuid("bio_page_id")
      .notNull()
      .references(() => bioPages.id, { onDelete: "cascade" }),
    position: smallint("position").notNull(),
    kind: varchar("kind", { length: 12 }).notNull(),
    title: varchar("title", { length: 160 }).notNull(),
    subtitle: varchar("subtitle", { length: 200 }),
    /** Blocks that point somewhere go through a real link, so they get the
     *  same analytics, safety scanning and routing as anything else. */
    linkId: uuid("link_id").references(() => links.id, { onDelete: "set null" }),
    href: text("href"),
    locked: jsonb("locked").$type<boolean>().notNull().default(false),
    clicks: integer("clicks").notNull().default(0),
  },
  (t) => [uniqueIndex("bio_blocks_page_position_key").on(t.bioPageId, t.position)],
);

/** Append-only. Written by an interceptor rather than by hand, because an audit
 *  log that individual handlers remember to write is an audit log with holes. */
export const auditLog = pgTable(
  "audit_log",
  {
    id: id(),
    workspaceId: uuid("workspace_id")
      .notNull()
      .references(() => workspaces.id, { onDelete: "cascade" }),
    actorId: uuid("actor_id").references(() => users.id, { onDelete: "set null" }),
    actorLabel: varchar("actor_label", { length: 160 }).notNull(),
    action: varchar("action", { length: 80 }).notNull(),
    targetType: varchar("target_type", { length: 40 }),
    targetId: uuid("target_id"),
    metadata: jsonb("metadata"),
    at: timestamp("at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("audit_log_workspace_time_idx").on(t.workspaceId, t.at.desc())],
);

export const webhooksRelations = relations(webhooks, ({ many }) => ({
  deliveries: many(webhookDeliveries),
}));

export const bioPagesRelations = relations(bioPages, ({ one, many }) => ({
  domain: one(domains, { fields: [bioPages.domainId], references: [domains.id] }),
  blocks: many(bioBlocks),
}));

export const bioBlocksRelations = relations(bioBlocks, ({ one }) => ({
  page: one(bioPages, { fields: [bioBlocks.bioPageId], references: [bioPages.id] }),
}));
