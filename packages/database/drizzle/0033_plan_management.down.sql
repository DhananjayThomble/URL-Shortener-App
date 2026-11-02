-- Down migration for 0031_plan_management (#992, billing 6/6).
--
-- drizzle-kit's migrator is forward-only (it tracks applied migrations in
-- __drizzle_migrations and never runs a down), so this file is not executed
-- automatically. It is the authoritative, reviewed reverse: 0031 ADDED two
-- tables (plan_change_requests, workspace_plan_history), both purely additive
-- with no column changes to existing tables, so reversing it drops them and
-- leaves the schema byte-identical to before. Their indexes and foreign keys
-- drop with the tables.
--
-- Takes slot 0033 by conductor assignment: 0031 is #988's billing_pending_change
-- (merged to main), 0032 is reserved for #997 (PR #1016). Renumber again if the
-- slot moves.
--
-- To roll back by hand: delete the 0031 row from __drizzle_migrations and run
-- the statements below.
DROP TABLE IF EXISTS "plan_change_requests";
--> statement-breakpoint
DROP TABLE IF EXISTS "workspace_plan_history";
