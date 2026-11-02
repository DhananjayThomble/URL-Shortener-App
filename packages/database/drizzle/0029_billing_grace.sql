-- #989 — subscription lifecycle. Additive: one nullable column on the existing
-- subscriptions table (#986) to track a failed-payment grace window. The plan
-- stays entitled until grace_ends_at, then reverts to free. Nullable with no
-- default, so existing rows are untouched and nothing backfills. Takes 0029 as
-- the next free slot: #970's 0027_plans_engine is on main and sibling #993
-- reserved 0028_workspace_new_account_limits_lifted, so #989 yields 0028 to it
-- and takes 0029 to avoid a merge-train collision.
ALTER TABLE "subscriptions" ADD COLUMN "grace_ends_at" timestamp with time zone;
