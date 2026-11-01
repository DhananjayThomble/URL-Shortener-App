-- Down migration for 0022_admin_audit_log (#968).
--
-- drizzle-kit's migrator is forward-only (it tracks applied migrations in
-- __drizzle_migrations and never runs a down), so this file is not executed
-- automatically. It is kept beside the up migration as the authoritative,
-- reviewed reverse: the issue requires the migration be reversible, and this
-- is what "reversible" means for an additive change — dropping the table and
-- its indexes leaves the schema byte-identical to before 0022.
--
-- To roll back by hand: delete the 0022 row from __drizzle_migrations (so the
-- migrator does not think it is still applied) and run the statements below.
-- Safe because 0022 only ADDED a table: nothing else references it, so the
-- drop cannot orphan another object.

DROP INDEX IF EXISTS "admin_audit_log_actor_time_idx";--> statement-breakpoint
DROP INDEX IF EXISTS "admin_audit_log_time_idx";--> statement-breakpoint
DROP TABLE IF EXISTS "admin_audit_log";
