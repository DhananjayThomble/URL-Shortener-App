-- Down migration for 0035_billing_details (#992 PR-C).
--
-- drizzle-kit's migrator is forward-only, so this is the authoritative reviewed
-- reverse: 0035 ADDED one table (workspace_billing_details) and two columns on
-- subscriptions (cancellation_reason, cancellation_comment). Reversing it drops
-- them and leaves the schema byte-identical to before.
--
-- Slot 0035: after #992 PR-B's 0034 (trials + coupons).
--
-- To roll back by hand: delete the 0035 row from __drizzle_migrations and run
-- the statements below.
DROP TABLE IF EXISTS "workspace_billing_details";
--> statement-breakpoint
ALTER TABLE "subscriptions" DROP COLUMN IF EXISTS "cancellation_comment";
--> statement-breakpoint
ALTER TABLE "subscriptions" DROP COLUMN IF EXISTS "cancellation_reason";
