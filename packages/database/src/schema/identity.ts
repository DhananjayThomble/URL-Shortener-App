import {
  boolean,
  index,
  integer,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
  varchar,
} from "drizzle-orm/pg-core";
import { relations, sql } from "drizzle-orm";

/* ============================================================
   Users, workspaces, membership, and session tokens.

   Every row in every other table belongs to a workspace, and
   every query in the API filters on membership. That invariant
   is the entire multi-tenancy story — there is no row-level
   security to fall back on if a query forgets.
   ============================================================ */

/** UUIDv7: time-ordered, so cursor pagination and index locality both work,
 *  and unguessable, unlike a serial that lets anyone enumerate the table. */
const id = () => uuid("id").primaryKey().default(sql`uuidv7()`);

export const users = pgTable(
  "users",
  {
    id: id(),
    name: varchar("name", { length: 120 }).notNull(),
    email: varchar("email", { length: 255 }).notNull(),
    /** argon2id. Never bcrypt — it silently truncates at 72 bytes. */
    passwordHash: text("password_hash").notNull(),
    emailVerifiedAt: timestamp("email_verified_at", { withTimezone: true }),

    /* G6 — the team page renders a 2FA column, so it needs a real flow. */
    totpSecret: text("totp_secret"),
    totpEnabledAt: timestamp("totp_enabled_at", { withTimezone: true }),

    lastActiveAt: timestamp("last_active_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [uniqueIndex("users_email_key").on(sql`lower(${t.email})`)],
);

/** Ten single-use codes issued at enrolment. Without them a lost phone is a
 *  lost account, which on a side project means a support burden you cannot serve. */
export const recoveryCodes = pgTable(
  "recovery_codes",
  {
    id: id(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    codeHash: text("code_hash").notNull(),
    usedAt: timestamp("used_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("recovery_codes_user_idx").on(t.userId)],
);

export const workspaces = pgTable(
  "workspaces",
  {
    id: id(),
    name: varchar("name", { length: 120 }).notNull(),
    slug: varchar("slug", { length: 80 }).notNull(),
    plan: varchar("plan", { length: 40 }).notNull().default("Free"),

    defaultDomainId: uuid("default_domain_id"),
    defaultRedirect: varchar("default_redirect", { length: 3 }).notNull().default("302"),

    clicksIncluded: integer("clicks_included").notNull().default(1_000_000),

    /* Privacy settings the product makes promises about. */
    retentionYears: integer("retention_years").notNull().default(3),
    cookielessAnalytics: boolean("cookieless_analytics").notNull().default(true),
    scanOnCreate: boolean("scan_on_create").notNull().default(true),
    publicPreviews: boolean("public_previews").notNull().default(true),

    /** G7 — reports have to say what currency they are in. */
    currency: varchar("currency", { length: 3 }).notNull().default("INR"),

    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [uniqueIndex("workspaces_slug_key").on(t.slug)],
);

export const memberships = pgTable(
  "memberships",
  {
    id: id(),
    workspaceId: uuid("workspace_id")
      .notNull()
      .references(() => workspaces.id, { onDelete: "cascade" }),
    userId: uuid("user_id").references(() => users.id, { onDelete: "cascade" }),

    /** Invitations exist before the user does, so email is stored here too. */
    email: varchar("email", { length: 255 }).notNull(),
    role: varchar("role", { length: 20 }).notNull().default("editor"),
    status: varchar("status", { length: 20 }).notNull().default("active"),

    inviteTokenHash: text("invite_token_hash"),
    invitedAt: timestamp("invited_at", { withTimezone: true }),
    acceptedAt: timestamp("accepted_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex("memberships_workspace_email_key").on(t.workspaceId, sql`lower(${t.email})`),
    index("memberships_user_idx").on(t.userId),
  ],
);

/* G2 — logout used to be client-side only, so a refresh token stayed valid for
   its full 30-day life after the user signed out.

   Tokens are stored hashed and grouped into a family. Rotating a token marks
   the old one replaced; presenting an already-replaced token means it leaked,
   and the whole family is revoked rather than just that one token. */
export const refreshTokens = pgTable(
  "refresh_tokens",
  {
    id: id(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    familyId: uuid("family_id").notNull(),
    tokenHash: text("token_hash").notNull(),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    revokedAt: timestamp("revoked_at", { withTimezone: true }),
    replacedById: uuid("replaced_by_id"),
    userAgent: text("user_agent"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex("refresh_tokens_hash_key").on(t.tokenHash),
    index("refresh_tokens_user_idx").on(t.userId),
    index("refresh_tokens_family_idx").on(t.familyId),
  ],
);

export const usersRelations = relations(users, ({ many }) => ({
  memberships: many(memberships),
  refreshTokens: many(refreshTokens),
  recoveryCodes: many(recoveryCodes),
}));

export const workspacesRelations = relations(workspaces, ({ many }) => ({
  memberships: many(memberships),
}));

export const membershipsRelations = relations(memberships, ({ one }) => ({
  workspace: one(workspaces, { fields: [memberships.workspaceId], references: [workspaces.id] }),
  user: one(users, { fields: [memberships.userId], references: [users.id] }),
}));
