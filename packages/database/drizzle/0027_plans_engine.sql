CREATE TABLE "plan_versions" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"plan_id" uuid NOT NULL,
	"version" integer NOT NULL,
	"features" jsonb NOT NULL,
	"limits" jsonb NOT NULL,
	"pricing" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "plans" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"key" varchar(40) NOT NULL,
	"display_name" varchar(80) NOT NULL,
	"description" varchar(280) DEFAULT '' NOT NULL,
	"highlight_badge" varchar(40),
	"sort_order" integer DEFAULT 0 NOT NULL,
	"visibility" varchar(10) DEFAULT 'public' NOT NULL,
	"current_version_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "usage_warnings" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"limit_name" varchar(40) NOT NULL,
	"band" varchar(10) NOT NULL,
	"notified_at" timestamp with time zone,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "workspace_plan_overrides" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"kind" varchar(10) NOT NULL,
	"name" varchar(40) NOT NULL,
	"value" jsonb NOT NULL,
	"expires_at" timestamp with time zone,
	"created_by_id" uuid,
	"created_by_label" varchar(255),
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "workspaces" ADD COLUMN "plan_version_id" uuid;--> statement-breakpoint
ALTER TABLE "plan_versions" ADD CONSTRAINT "plan_versions_plan_id_plans_id_fk" FOREIGN KEY ("plan_id") REFERENCES "public"."plans"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "usage_warnings" ADD CONSTRAINT "usage_warnings_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "workspace_plan_overrides" ADD CONSTRAINT "workspace_plan_overrides_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "workspace_plan_overrides" ADD CONSTRAINT "workspace_plan_overrides_created_by_id_users_id_fk" FOREIGN KEY ("created_by_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "plan_versions_plan_version_key" ON "plan_versions" USING btree ("plan_id","version");--> statement-breakpoint
CREATE UNIQUE INDEX "plans_key_key" ON "plans" USING btree (lower("key"));--> statement-breakpoint
CREATE UNIQUE INDEX "usage_warnings_workspace_limit_key" ON "usage_warnings" USING btree ("workspace_id","limit_name");--> statement-breakpoint
CREATE UNIQUE INDEX "workspace_plan_overrides_target_key" ON "workspace_plan_overrides" USING btree ("workspace_id","kind","name");--> statement-breakpoint
CREATE INDEX "workspace_plan_overrides_workspace_idx" ON "workspace_plan_overrides" USING btree ("workspace_id");