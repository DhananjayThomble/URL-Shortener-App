-- #989 — subscription lifecycle. Additive: one nullable column on the existing
-- subscriptions table (#986) to track a failed-payment grace window. The plan
-- stays entitled until grace_ends_at, then reverts to free. Nullable with no
-- default, so existing rows are untouched and nothing backfills. Takes 0030 as
-- the next free slot: 0027 = #970 plans engine, 0028 = #993 sign-up abuse
-- controls, 0029 = #987 plan-prices backfill — so #989 takes 0030 to avoid a
-- merge-train collision.
ALTER TABLE "subscriptions" ADD COLUMN "grace_ends_at" timestamp with time zone;
