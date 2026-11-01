-- #972 — platform-settings store (admin panel 5/7).
--
-- One row per setting key: the current value as jsonb (validated against a
-- per-key zod schema in the API before it is written), plus who last changed
-- it and when, which is what the admin panel shows per setting. A key with no
-- row means "never set" — the API falls back to its compiled-in default (and,
-- for the rate limits, to the env values), so a fresh deploy with an empty
-- table behaves exactly as it did before this table existed.
--
-- Purely additive: a new table with no backfill and no change to any existing
-- table, so it applies online. The full history of who changed what is the
-- admin_audit_log (every settings write records a before/after row there);
-- this table only holds the current value and the last-writer stamp.
CREATE TABLE "platform_settings" (
	"key" varchar(64) PRIMARY KEY NOT NULL,
	"value" jsonb NOT NULL,
	"updated_by_id" uuid,
	"updated_by_label" varchar(255),
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "platform_settings" ADD CONSTRAINT "platform_settings_updated_by_id_users_id_fk" FOREIGN KEY ("updated_by_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;
