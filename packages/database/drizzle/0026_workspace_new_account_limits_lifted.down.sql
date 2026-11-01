-- Down migration for 0026_workspace_new_account_limits_lifted (#993).
--
-- drizzle-kit's migrator is forward-only (it tracks applied migrations in
-- __drizzle_migrations and never runs a down), so this file is not executed
-- automatically. It is the authoritative, reviewed reverse: 0026 only ADDED a
-- nullable column, so dropping it leaves the schema byte-identical to before.
--
-- To roll back by hand: delete the 0026 row from __drizzle_migrations and run
-- the statement below. Safe because nothing else references the column.

ALTER TABLE "workspaces" DROP COLUMN IF EXISTS "new_account_limits_lifted_at";
