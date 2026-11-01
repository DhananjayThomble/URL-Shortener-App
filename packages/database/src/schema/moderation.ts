import { index, pgTable, text, timestamp, uniqueIndex, uuid, varchar } from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";
import { users } from "./identity.js";

/* ============================================================
   #971 — platform moderation: the destination blocklist.

   A platform admin maintains a list of destination domains that no link may
   point to. It is checked on link CREATE and UPDATE (apps/api links.service),
   right beside the existing SSRF guard, so a blocklisted host is refused the
   same way a private-address host is. This is PLATFORM-scoped policy — one list
   for the whole platform — which is why it lives here and not on a workspace.

   A row stores the registrable host exactly as the admin entered it, lower-cased
   on write, and matched against a destination's hostname AND any parent domain
   of it (so blocking "evil.test" also refuses "login.evil.test"). The match
   logic is in @snapurl/domain (hostMatchesBlocklist) so the API and any test
   share one definition.

   Append-and-remove, not append-only: an admin can lift a block. Every add and
   remove is recorded in the platform admin audit trail (writeAdminAuditEntry),
   so the row itself need not be a tombstone — the audit log is the history.
   ============================================================ */

/** UUIDv7: time-ordered and unguessable, same id strategy as every other table. */
const id = () => uuid("id").primaryKey().default(sql`uuidv7()`);

export const blockedDomains = pgTable(
  "blocked_domains",
  {
    id: id(),
    /** The registrable host, lower-cased on write (e.g. "evil.test"). A link
     *  whose destination hostname equals this, or is a sub-domain of it, is
     *  refused. 253 is the max length of a DNS name. */
    domain: varchar("domain", { length: 253 }).notNull(),
    /** Why it was blocked — shown in the admin list and the audit trail. */
    reason: text("reason"),
    /** The platform admin who added it. SET NULL on user delete so the row (and
     *  thus the active block) outlives the actor; the label preserves who. */
    addedBy: uuid("added_by").references(() => users.id, { onDelete: "set null" }),
    /** The adder's email at the time, retained even if addedBy is later nulled. */
    addedByLabel: varchar("added_by_label", { length: 255 }).notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    // One row per host: adding a host already blocked is a no-op, not a duplicate.
    uniqueIndex("blocked_domains_domain_key").on(sql`lower(${t.domain})`),
    index("blocked_domains_created_idx").on(t.createdAt.desc()),
  ],
);
