-- #989 — subscription lifecycle. Additive: one nullable column on the existing
-- subscriptions table (#986) to track a failed-payment grace window. The plan
-- stays entitled until grace_ends_at, then reverts to free. Nullable with no
-- default, so existing rows are untouched and nothing backfills. Takes 0028 as
-- the next free slot after #970's 0027_plans_engine landed on main.
ALTER TABLE "subscriptions" ADD COLUMN "grace_ends_at" timestamp with time zone;
