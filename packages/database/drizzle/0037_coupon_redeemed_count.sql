-- #1024 — coupon cap enforced atomically under concurrency.
--
-- The cross-workspace maxRedemptions cap was a read-then-write: validate()
-- SELECT-counted coupon_redemptions, recordRedemption() INSERTed later, and
-- two concurrent redemptions by DIFFERENT workspaces both read count < max and
-- both landed, over-redeeming a limited coupon. The (coupon_id, workspace_id)
-- unique index only guards the SAME workspace redeeming twice.
--
-- Fix: an authoritative redeemed_count on the coupon, bumped with a conditional
-- `WHERE max_redemptions IS NULL OR redeemed_count < max_redemptions` in the
-- same transaction as the redemption INSERT, so the DB (not a read-then-write)
-- is the cap arbiter. Additive and backward-compatible: the column defaults 0,
-- and is backfilled from the live redemption rows so existing coupons keep an
-- accurate count. Slot 0037, after #1020's 0036 (kill switches).
ALTER TABLE "coupons" ADD COLUMN "redeemed_count" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
-- Backfill the counter from the real redemption rows so an existing coupon's
-- cap is enforced from its true current count, not from zero.
UPDATE "coupons" SET "redeemed_count" = (
  SELECT count(*) FROM "coupon_redemptions" WHERE "coupon_redemptions"."coupon_id" = "coupons"."id"
);
