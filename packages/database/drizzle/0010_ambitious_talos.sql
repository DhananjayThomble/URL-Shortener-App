/* ============================================================
   Abuse reports (#291).

   The only way a victim can tell an operator that a short link points at
   phishing or malware. The intake is unauthenticated, so the table is
   deliberately forgiving about what it can resolve.

   `slug` is stored raw and is NOT a foreign key: a report may name a slug that
   never existed (a typo) or one whose link is already deleted, and losing that
   report would defeat the endpoint. `link_id` and `workspace_id` are
   best-effort resolutions kept nullable — set null when the slug names nothing.
   `link_id` is ON DELETE set null so a report outlives the link it was about;
   `workspace_id` cascades because a deleted workspace has nobody left to action
   anything.

   Indexed on status (the operator queue), lower(slug) (grouping reports about
   the same link), and workspace_id (scoping the operator listing in FEAT-003).
   ============================================================ */
CREATE TABLE "abuse_reports" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"slug" varchar(64) NOT NULL,
	"link_id" uuid,
	"workspace_id" uuid,
	"reason" text NOT NULL,
	"reporter_contact" varchar(320),
	"status" varchar(20) DEFAULT 'open' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "abuse_reports" ADD CONSTRAINT "abuse_reports_link_id_links_id_fk" FOREIGN KEY ("link_id") REFERENCES "public"."links"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "abuse_reports" ADD CONSTRAINT "abuse_reports_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "abuse_reports_status_idx" ON "abuse_reports" USING btree ("status");--> statement-breakpoint
CREATE INDEX "abuse_reports_slug_idx" ON "abuse_reports" USING btree (lower("slug"));--> statement-breakpoint
CREATE INDEX "abuse_reports_workspace_idx" ON "abuse_reports" USING btree ("workspace_id");