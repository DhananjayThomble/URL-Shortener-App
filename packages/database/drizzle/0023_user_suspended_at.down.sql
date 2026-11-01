-- Down migration for 0023_user_suspended_at (#969).
--
-- drizzle-kit's migrator is forward-only (it tracks applied migrations in
-- __drizzle_migrations and never runs a down), so this file is not executed
-- automatically. It is the authoritative, reviewed reverse: 0023 only ADDED a
-- nullable column, so dropping it leaves the schema byte-identical to before.
--
-- To roll back by hand: delete the 0023 row from __drizzle_migrations and run
-- the statement below. Safe because nothing else references the column.

ALTER TABLE "users" DROP COLUMN IF EXISTS "suspended_at";
