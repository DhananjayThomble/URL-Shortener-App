import {
  boolean,
  index,
  integer,
  jsonb,
  pgTable,
  real,
  smallint,
  text,
  timestamp,
  uniqueIndex,
  uuid,
  varchar,
} from "drizzle-orm/pg-core";
import { relations, sql } from "drizzle-orm";
import { workspaces, users } from "./identity.js";

const id = () => uuid("id").primaryKey().default(sql`uuidv7()`);

export const domains = pgTable(
  "domains",
  {
    id: id(),
    /* NULL means a system domain — the shared short domain every workspace
       can put links on (snap.to in the fixtures). Custom domains belong to
       exactly one workspace. Both live here because the redirect path resolves
       (host, slug) without caring which kind it found. */
    workspaceId: uuid("workspace_id").references(() => workspaces.id, { onDelete: "cascade" }),
    domain: varchar("domain", { length: 253 }).notNull(),
    isSystem: boolean("is_system").notNull().default(false),

    /* Two separate state machines that the UI shows side by side.
       A domain can be verified but still waiting on its certificate. */
    status: varchar("status", { length: 20 }).notNull().default("verifying"),
    ssl: varchar("ssl", { length: 20 }).notNull().default("pending"),
    sslRenewsAt: timestamp("ssl_renews_at", { withTimezone: true }),
    certificateArn: text("certificate_arn"),

    /** The random token the customer puts in a TXT record to prove ownership. */
    verificationToken: varchar("verification_token", { length: 64 }),
    verifiedAt: timestamp("verified_at", { withTimezone: true }),

    rootRedirect: text("root_redirect"),
    notFoundRedirect: text("not_found_redirect"),

    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    // Globally unique: two workspaces cannot both claim snap.to.
    uniqueIndex("domains_domain_key").on(sql`lower(${t.domain})`),
    index("domains_workspace_idx").on(t.workspaceId),
  ],
);

export const links = pgTable(
  "links",
  {
    id: id(),
    workspaceId: uuid("workspace_id")
      .notNull()
      .references(() => workspaces.id, { onDelete: "cascade" }),
    domainId: uuid("domain_id")
      .notNull()
      .references(() => domains.id, { onDelete: "restrict" }),

    slug: varchar("slug", { length: 64 }).notNull(),
    destination: text("destination").notNull(),

    title: varchar("title", { length: 200 }),
    comment: varchar("comment", { length: 280 }),
    tags: text("tags").array().notNull().default(sql`ARRAY[]::text[]`),
    folder: varchar("folder", { length: 120 }),

    redirectType: varchar("redirect_type", { length: 3 }).notNull().default("302"),

    expiresAt: timestamp("expires_at", { withTimezone: true }),
    /** G5 — was write-only, so it could be set once and never read or corrected. */
    expiresTo: text("expires_to"),
    /* The mirror of expires_at: when the link starts working. Null means it
       already does. Nothing runs to flip it — status is derived from the clock
       on every read, so a link scheduled for Friday goes live on Friday
       whether or not a process was alive to notice. */
    activatesAt: timestamp("activates_at", { withTimezone: true }),
    /** Where a click lands before activates_at. Null means a plain "not yet" page. */
    scheduledTo: text("scheduled_to"),
    clickLimit: integer("click_limit"),

    /** G3 — argon2id, same as a user password. Null means no password. */
    passwordHash: text("password_hash"),

    forwardQuery: boolean("forward_query").notNull().default(true),
    deepLink: boolean("deep_link").notNull().default(false),
    hideReferrer: boolean("hide_referrer").notNull().default(false),
    publicPreview: boolean("public_preview").notNull().default(true),
    cloaked: boolean("cloaked").notNull().default(false),

    safeBrowsingStatus: varchar("safe_browsing_status", { length: 20 }).notNull().default("pending"),
    safeBrowsingCheckedAt: timestamp("safe_browsing_checked_at", { withTimezone: true }),

    utm: jsonb("utm").$type<{
      source?: string | null;
      medium?: string | null;
      campaign?: string | null;
      content?: string | null;
    } | null>(),
    social: jsonb("social").$type<{
      title?: string | null;
      description?: string | null;
      image?: string | null;
    } | null>(),

    /* Denormalised counters.

       These are maintained by the rollup worker, not incremented on the hot
       path. A redirect that had to UPDATE a row would serialise every click on
       a popular link behind a single row lock — the exact failure the v1
       backend had, where redirectToURL did findOne + updateOne on every hit. */
    clicks: integer("clicks").notNull().default(0),
    uniqueClicks: integer("unique_clicks").notNull().default(0),

    createdBy: uuid("created_by").references(() => users.id, { onDelete: "set null" }),
    archivedAt: timestamp("archived_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    /* The invariant the whole product rests on: one destination per short URL.
       Case-insensitive, because a printed QR code read as SNAP.TO/Spring must
       not resolve to a different link than snap.to/spring. */
    uniqueIndex("links_domain_slug_key").on(t.domainId, sql`lower(${t.slug})`),
    index("links_workspace_created_idx").on(t.workspaceId, t.createdAt.desc(), t.id.desc()),
    index("links_workspace_tags_idx").using("gin", t.tags),
    index("links_expires_idx").on(t.expiresAt).where(sql`${t.expiresAt} is not null`),
    /* Same shape as the expiry index and for the same reason: the scheduled
       filter scans on this column, and the overwhelming majority of links
       never set it. */
    index("links_activates_idx").on(t.activatesAt).where(sql`${t.activatesAt} is not null`),
  ],
);

export const routingRules = pgTable(
  "routing_rules",
  {
    id: id(),
    linkId: uuid("link_id")
      .notNull()
      .references(() => links.id, { onDelete: "cascade" }),

    /** First match wins, so the order of the chain is data, not presentation. */
    position: smallint("position").notNull(),

    whenCountry: varchar("when_country", { length: 2 }),
    whenDevice: varchar("when_device", { length: 10 }),
    whenLanguage: varchar("when_language", { length: 8 }),

    then: text("then").notNull(),
    weight: real("weight"),

    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [uniqueIndex("routing_rules_link_position_key").on(t.linkId, t.position)],
);

/* The transactional outbox for the DynamoDB projection.

   The redirect path reads link config from DynamoDB, not Postgres. Writing to
   both inside one API request would mean a crash between the two leaves the
   edge serving a stale destination with nothing to detect it. Instead the
   Postgres write and the outbox row commit together, and a worker drains the
   outbox — so a failed projection retries rather than silently diverging. */
export const projectionOutbox = pgTable(
  "projection_outbox",
  {
    id: id(),
    linkId: uuid("link_id").notNull(),
    operation: varchar("operation", { length: 10 }).notNull(),
    payload: jsonb("payload").notNull(),
    attempts: smallint("attempts").notNull().default(0),
    lastError: text("last_error"),
    processedAt: timestamp("processed_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("projection_outbox_pending_idx").on(t.createdAt).where(sql`${t.processedAt} is null`)],
);

export const domainsRelations = relations(domains, ({ one, many }) => ({
  workspace: one(workspaces, { fields: [domains.workspaceId], references: [workspaces.id] }),
  links: many(links),
}));

export const linksRelations = relations(links, ({ one, many }) => ({
  workspace: one(workspaces, { fields: [links.workspaceId], references: [workspaces.id] }),
  domain: one(domains, { fields: [links.domainId], references: [domains.id] }),
  creator: one(users, { fields: [links.createdBy], references: [users.id] }),
  rules: many(routingRules),
}));

export const routingRulesRelations = relations(routingRules, ({ one }) => ({
  link: one(links, { fields: [routingRules.linkId], references: [links.id] }),
}));
