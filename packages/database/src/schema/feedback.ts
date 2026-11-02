import { index, pgTable, text, timestamp, uuid, varchar } from "drizzle-orm/pg-core";
import { relations, sql } from "drizzle-orm";
import { users, workspaces } from "./identity.js";

const id = () => uuid("id").primaryKey().default(sql`uuidv7()`);

/* ============================================================
   In-app "Report a problem" feedback — #997.

   A user (signed in or not) reports a problem in two clicks and the operator
   sees it with context. This is NOT abuse reporting (that is abuse_reports,
   #291): abuse reports flag a malicious short link; feedback reports a problem
   with the product itself — a bug, a confusing page, a broken flow.

   The intake is deliberately forgiving, because it is reachable by signed-out
   visitors on public pages: `userId` and `workspaceId` are best-effort context
   attached only when the submitter is authenticated, kept nullable, and set
   null / cascade on delete so a report outlives the account it came from
   without becoming orphaned PII. Everything the client captures automatically
   (the page, the browser's user-agent, the app version, and an optional
   error-tracking event id) is context stored alongside the free-text message.

   The admin inbox (AdminFeedbackService) reads these rows and moves each
   through its lifecycle (new → in_progress → done) with operator notes, every
   change audited through writeAdminAuditEntry.
   ============================================================ */
export const feedback = pgTable(
  "feedback",
  {
    id: id(),

    /* The submitter's free text — what is wrong. Required and non-trivial (the
       contract floors it at 3 chars); 4000 is a generous ceiling that still
       bounds a single row so the unauthenticated write cannot store an essay. */
    message: text("message").notNull(),

    /* Context attached automatically by the client. All optional strings,
       length-capped so a crafted request cannot bloat the row:
         - page: the URL/path the report was filed from;
         - userAgent: the browser string (navigator.userAgent);
         - appVersion: the web build version on the page. */
    page: varchar("page", { length: 2048 }),
    userAgent: varchar("user_agent", { length: 1024 }),
    appVersion: varchar("app_version", { length: 100 }),

    /* #997 point 4 — if an error-tracking event id (#995) is on the page, it is
       attached so the operator can correlate the report with the captured
       error. #995 is not built and its vendor is undecided, so this is an
       optional, validated opaque string and NO vendor SDK is involved. */
    errorEventId: varchar("error_event_id", { length: 200 }),

    /* An optional, size-bounded screenshot the client may attach, stored inline
       as a data URL (validated server-side for type and size — see the contract
       and FeedbackService). Kept nullable: most reports have no screenshot, and
       a signed-out report on a public page may not offer one. */
    screenshot: text("screenshot"),

    /* Best-effort submitter context, present only for an authenticated report.
       `set null` on delete so a deleted user's reports survive for the operator
       without carrying a dangling reference; the workspace cascades (if the
       workspace is gone there is nobody to action it for). */
    userId: uuid("user_id").references(() => users.id, { onDelete: "set null" }),
    workspaceId: uuid("workspace_id").references(() => workspaces.id, { onDelete: "cascade" }),

    /* The contact the operator can reply to. For a signed-in report this is the
       account email, captured at intake; for a signed-out report it is null
       unless the form collected one. 320 = max email length. */
    reporterEmail: varchar("reporter_email", { length: 320 }),

    /* Inbox lifecycle: new → in_progress → done. A varchar (not a pg enum) to
       match the abuse_reports.status convention; the contract's zod enum is the
       validation oracle. */
    status: varchar("status", { length: 20 }).notNull().default("new"),

    /* Free-text operator notes, set from the admin inbox. */
    notes: text("notes"),

    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    // The inbox lists newest-first and filters on status.
    index("feedback_status_idx").on(t.status),
    index("feedback_created_idx").on(t.createdAt),
    index("feedback_workspace_idx").on(t.workspaceId),
  ],
);

export const feedbackRelations = relations(feedback, ({ one }) => ({
  user: one(users, { fields: [feedback.userId], references: [users.id] }),
  workspace: one(workspaces, { fields: [feedback.workspaceId], references: [workspaces.id] }),
}));
