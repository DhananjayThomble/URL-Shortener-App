CREATE TABLE "blocked_domains" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"domain" varchar(253) NOT NULL,
	"reason" text,
	"added_by" uuid,
	"added_by_label" varchar(255) NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "links" ADD COLUMN "disabled_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "blocked_domains" ADD CONSTRAINT "blocked_domains_added_by_users_id_fk" FOREIGN KEY ("added_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "blocked_domains_domain_key" ON "blocked_domains" USING btree (lower("domain"));--> statement-breakpoint
CREATE INDEX "blocked_domains_created_idx" ON "blocked_domains" USING btree ("created_at" DESC NULLS LAST);