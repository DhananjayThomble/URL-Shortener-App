-- Down migration for 0030_billing_grace (#989).
--
-- drizzle-kit's migrator is forward-only (it tracks applied migrations in
-- __drizzle_migrations and never runs a down), so this file is not executed
-- automatically. It is kept beside the up migration as the authoritative,
-- reviewed reverse: the change is a single additive nullable column, so
-- dropping it leaves the schema byte-identical to before 0030.
--
-- To roll back by hand: delete the 0030 row from __drizzle_migrations (so the
-- migrator does not think it is still applied) and run the statement below.
-- Safe because 0030 only ADDED a column nothing else references.

ALTER TABLE "subscriptions" DROP COLUMN IF EXISTS "grace_ends_at";
