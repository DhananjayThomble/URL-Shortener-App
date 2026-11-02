-- Down migration for 0026_plans_engine (#970).
--
-- drizzle-kit's migrator is forward-only (it tracks applied migrations in
-- __drizzle_migrations and never runs a down), so this file is not executed
-- automatically. It is the authoritative, reviewed reverse: 0026 ADDED three
-- tables and one nullable column, so reversing it drops them and leaves the
-- schema byte-identical to before. Order matters — plan_versions and
-- workspace_plan_overrides reference plans/workspaces, so drop the children
-- first, then the parent, then the added column.
--
-- To roll back by hand: delete the 0026 row from __drizzle_migrations and run
-- the statements below.
ALTER TABLE "workspaces" DROP COLUMN IF EXISTS "plan_version_id";
--> statement-breakpoint
DROP TABLE IF EXISTS "workspace_plan_overrides";
--> statement-breakpoint
DROP TABLE IF EXISTS "plan_versions";
--> statement-breakpoint
DROP TABLE IF EXISTS "plans";
