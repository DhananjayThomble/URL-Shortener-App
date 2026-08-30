import { index, pgTable, text, timestamp, uuid, varchar } from "drizzle-orm/pg-core";
import { relations, sql } from "drizzle-orm";
import { workspaces } from "./identity.js";
import { links } from "./links.js";

const id = () => uuid("id").primaryKey().default(sql`uuidv7()`);

/* ============================================================
   Abuse reports — #291.

   The only way a victim can tell the operator that a link is a phishing page.
   The intake is unauthenticated, so the row is deliberately forgiving about
   what it can resolve: a report may name a slug that does not exist (a typo, or
   a link already deleted), and it must survive being filed anyway. That is why
   `slug` is stored raw and is NOT a foreign key, while `linkId` and
   `workspaceId` are best-effort resolutions kept nullable.

   FEAT-003 adds the operator-side review/flag surface that reads these rows,
   scoped by `workspaceId`, and flips links.safeBrowsingStatus to 'flagged'.
   ============================================================ */
export const abuseReports = pgTable(
  "abuse_reports",
  {
    id: id(),

    /* The reported slug exactly as it was typed — not a foreign key, because a
       report may name a slug that does not resolve, and losing that report just
       because the link is gone would defeat the point of the endpoint. */
    slug: varchar("slug", { length: 64 }).notNull(),

    /* Best-effort resolution of the slug. Nullable and `set null` on delete so
       a report outlives the link it was about — the operator still needs to see
       "someone reported this slug" even after the link is removed. */
    linkId: uuid("link_id").references(() => links.id, { onDelete: "set null" }),

    /* The owning workspace, resolved at intake, used to scope the operator
       listing in FEAT-003. Cascades: if the workspace is gone there is nobody
       left to action the report. */
    workspaceId: uuid("workspace_id").references(() => workspaces.id, { onDelete: "cascade" }),

    reason: text("reason").notNull(),

    /* Optional — a reporter may want to stay anonymous. 320 is the max length
       of an email address (64 local + @ + 255 domain). */
    reporterContact: varchar("reporter_contact", { length: 320 }),

    status: varchar("status", { length: 20 }).notNull().default("open"),

    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    // The operator queue filters on status, and lists per workspace.
    index("abuse_reports_status_idx").on(t.status),
    index("abuse_reports_slug_idx").on(sql`lower(${t.slug})`),
    index("abuse_reports_workspace_idx").on(t.workspaceId),
  ],
);

export const abuseReportsRelations = relations(abuseReports, ({ one }) => ({
  link: one(links, { fields: [abuseReports.linkId], references: [links.id] }),
  workspace: one(workspaces, { fields: [abuseReports.workspaceId], references: [workspaces.id] }),
}));
