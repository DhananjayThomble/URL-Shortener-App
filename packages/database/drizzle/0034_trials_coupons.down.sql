-- Down migration for 0034_trials_coupons (#992 PR-B).
--
-- drizzle-kit's migrator is forward-only, so this is the authoritative reviewed
-- reverse: 0034 ADDED two tables (coupons, coupon_redemptions) and two columns
-- on plans (trial_days, trial_requires_card). Reversing it drops them and
-- leaves the schema byte-identical to before. Drop the child table first (it
-- references coupons), then coupons, then the plan columns.
--
-- Slot 0034: after #992 PR-A's 0033 (plan management); 0032 reserved for #997.
--
-- To roll back by hand: delete the 0034 row from __drizzle_migrations and run
-- the statements below.
DROP TABLE IF EXISTS "coupon_redemptions";
--> statement-breakpoint
DROP TABLE IF EXISTS "coupons";
--> statement-breakpoint
ALTER TABLE "plans" DROP COLUMN IF EXISTS "trial_requires_card";
--> statement-breakpoint
ALTER TABLE "plans" DROP COLUMN IF EXISTS "trial_days";
