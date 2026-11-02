-- #992 — plan-management (billing 6/6). Additive: two new tables
-- (plan_change_requests, workspace_plan_history) and their indexes/FKs. No
-- change to any existing table, so existing rows are untouched. Takes slot
-- 0031: 0029 = #987 plan-prices backfill (merged), 0030 = #989 subscription
-- grace (open PR #1010) — so #992 takes 0031 to avoid a merge-train collision.
-- Renumber again if the conductor says it moved.
CREATE TABLE "plan_change_requests" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"from_plan_key" varchar(40),
	"to_plan_key" varchar(40) NOT NULL,
	"kind" varchar(16) NOT NULL,
	"reason" text,
	"actor_id" uuid,
	"actor_label" varchar(255),
	"effective_at" timestamp with time zone NOT NULL,
	"applied_at" timestamp with time zone,
	"metadata" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "workspace_plan_history" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"kind" varchar(24) NOT NULL,
	"from_plan_key" varchar(40),
	"to_plan_key" varchar(40),
	"timing" varchar(12),
	"settlement" varchar(8),
	"amount_minor" text,
	"currency" varchar(3),
	"reason" text,
	"actor_id" uuid,
	"actor_label" varchar(255),
	"metadata" jsonb,
	"effective_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "plan_change_requests" ADD CONSTRAINT "plan_change_requests_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "plan_change_requests" ADD CONSTRAINT "plan_change_requests_actor_id_users_id_fk" FOREIGN KEY ("actor_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "workspace_plan_history" ADD CONSTRAINT "workspace_plan_history_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "workspace_plan_history" ADD CONSTRAINT "workspace_plan_history_actor_id_users_id_fk" FOREIGN KEY ("actor_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "plan_change_requests_due_idx" ON "plan_change_requests" USING btree ("applied_at","effective_at");--> statement-breakpoint
CREATE INDEX "plan_change_requests_workspace_idx" ON "plan_change_requests" USING btree ("workspace_id");--> statement-breakpoint
CREATE UNIQUE INDEX "plan_change_requests_pending_key" ON "plan_change_requests" USING btree ("workspace_id","kind") WHERE "plan_change_requests"."applied_at" is null;--> statement-breakpoint
CREATE INDEX "workspace_plan_history_workspace_idx" ON "workspace_plan_history" USING btree ("workspace_id","created_at");