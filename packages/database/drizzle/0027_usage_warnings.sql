CREATE TABLE "usage_warnings" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"limit_name" varchar(40) NOT NULL,
	"band" varchar(10) NOT NULL,
	"notified_at" timestamp with time zone,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "usage_warnings" ADD CONSTRAINT "usage_warnings_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "usage_warnings_workspace_limit_key" ON "usage_warnings" USING btree ("workspace_id","limit_name");