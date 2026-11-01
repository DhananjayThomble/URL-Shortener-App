-- Down migration for 0026_billing_core (#986).
--
-- drizzle-kit's migrator is forward-only (it tracks applied migrations in
-- __drizzle_migrations and never runs a down), so this file is not executed
-- automatically. It is kept beside the up migration as the authoritative,
-- reviewed reverse: the issue requires the migration be reversible, and this
-- is what "reversible" means for an additive change — dropping the three tables
-- and their indexes/constraints leaves the schema byte-identical to before 0026.
-- (The forward-compat columns trial_ends_at / offer_id / plan_version_id live
-- inside the subscriptions table, so dropping the table removes them too.)
--
-- Renumbered from 0025 to 0026 when #972 (platform settings) took 0025 on main.
--
-- To roll back by hand: delete the 0026 row from __drizzle_migrations (so the
-- migrator does not think it is still applied) and run the statements below.
-- Safe because 0026 only ADDED tables: nothing else references them, so the
-- drops cannot orphan another object. Dropping the table removes its indexes
-- and its foreign-key constraint with it, so only the three DROP TABLEs are
-- needed; the explicit DROP INDEX lines are belt-and-braces.

DROP INDEX IF EXISTS "subscriptions_provider_sub_key";--> statement-breakpoint
DROP INDEX IF EXISTS "subscriptions_workspace_key";--> statement-breakpoint
DROP INDEX IF EXISTS "payments_workspace_idx";--> statement-breakpoint
DROP INDEX IF EXISTS "payments_provider_payment_key";--> statement-breakpoint
DROP INDEX IF EXISTS "billing_events_workspace_idx";--> statement-breakpoint
DROP INDEX IF EXISTS "billing_events_provider_event_key";--> statement-breakpoint
DROP TABLE IF EXISTS "payments";--> statement-breakpoint
DROP TABLE IF EXISTS "subscriptions";--> statement-breakpoint
DROP TABLE IF EXISTS "billing_events";
