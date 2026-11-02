-- #988 — a REQUESTED paid-plan change, held until the provider confirms it.
-- Two nullable, additive columns on the existing subscriptions table (#986).
-- changePlan records the target HERE, never on plan_key/interval, so the next
-- ordinary entitled webhook (an old-plan renewal) cannot grant the new plan
-- without payment confirmation, and a downgrade is not applied before its cycle
-- end. A verified webhook whose provider plan id matches this target applies the
-- change onto plan_key/interval and clears these fields. Nullable with no
-- default, so existing rows are untouched and nothing backfills.
--
-- Slot 0031 is the next free number after main (0027 #970 plans, 0028 #993
-- sign-up abuse, 0029 #987 plan prices, 0030 #989 billing grace).
ALTER TABLE "subscriptions" ADD COLUMN "pending_plan_key" varchar(40);--> statement-breakpoint
ALTER TABLE "subscriptions" ADD COLUMN "pending_interval" varchar(10);
