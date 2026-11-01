CREATE TABLE "admin_audit_log" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"actor_id" uuid,
	"actor_label" varchar(255) NOT NULL,
	"action" varchar(80) NOT NULL,
	"target_type" varchar(40),
	"target_id" varchar(255),
	"before" jsonb,
	"after" jsonb,
	"request_ip" text,
	"at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "admin_audit_log" ADD CONSTRAINT "admin_audit_log_actor_id_users_id_fk" FOREIGN KEY ("actor_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "admin_audit_log_time_idx" ON "admin_audit_log" USING btree ("at" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "admin_audit_log_actor_time_idx" ON "admin_audit_log" USING btree ("actor_id","at" DESC NULLS LAST);