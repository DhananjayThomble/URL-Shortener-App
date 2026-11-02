-- Down migration for 0031_billing_pending_change (#988).
--
-- drizzle-kit's migrator is forward-only (it tracks applied migrations in
-- __drizzle_migrations and never runs a down), so this file is not executed
-- automatically. It is kept beside the up migration as the authoritative,
-- reviewed reverse: the change is two additive nullable columns, so dropping
-- them leaves the schema byte-identical to before 0031.
--
-- To roll back by hand: delete the 0031 row from __drizzle_migrations (so the
-- migrator does not think it is still applied) and run the statements below.
-- Safe because 0031 only ADDED columns nothing else references.

ALTER TABLE "subscriptions" DROP COLUMN IF EXISTS "pending_plan_key";
ALTER TABLE "subscriptions" DROP COLUMN IF EXISTS "pending_interval";
