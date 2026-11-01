DROP INDEX IF EXISTS "blocked_domains_created_idx";--> statement-breakpoint
DROP INDEX IF EXISTS "blocked_domains_domain_key";--> statement-breakpoint
ALTER TABLE "blocked_domains" DROP CONSTRAINT IF EXISTS "blocked_domains_added_by_users_id_fk";--> statement-breakpoint
DROP TABLE IF EXISTS "blocked_domains";--> statement-breakpoint
ALTER TABLE "links" DROP COLUMN IF EXISTS "disabled_at";
