-- Down migration for 0027_plans_engine (#970).
--
-- drizzle-kit's migrator is forward-only (it tracks applied migrations in
-- __drizzle_migrations and never runs a down), so this file is not executed
-- automatically. It is the authoritative, reviewed reverse: 0027 ADDED four
-- tables (plans, plan_versions, workspace_plan_overrides, usage_warnings) and
-- one nullable column (workspaces.plan_version_id), so reversing it drops them
-- and leaves the schema byte-identical to before. Order matters — the child
-- tables reference plans/workspaces/users, so drop them first, then the parent.
--
-- (This migration was 0026_plans_engine + 0027_usage_warnings before the merge
-- with #986's 0026_billing_core; renumbered to 0027 and folded into one delta
-- when billing took 0026 on main.)
--
-- To roll back by hand: delete the 0027 row from __drizzle_migrations and run
-- the statements below.
ALTER TABLE "workspaces" DROP COLUMN IF EXISTS "plan_version_id";
--> statement-breakpoint
DROP TABLE IF EXISTS "usage_warnings";
--> statement-breakpoint
DROP TABLE IF EXISTS "workspace_plan_overrides";
--> statement-breakpoint
DROP TABLE IF EXISTS "plan_versions";
--> statement-breakpoint
DROP TABLE IF EXISTS "plans";
