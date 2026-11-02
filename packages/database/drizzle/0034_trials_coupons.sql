-- #992 — trials + coupons (billing 6/6, PR-B). Additive: two new tables
-- (coupons, coupon_redemptions) and two nullable-default columns on plans
-- (trial_days, trial_requires_card). No change to existing rows (the plan
-- columns default 0/1 = no trial, card required). Slot 0034 by conductor
-- assignment, after #992 PR-A's 0033; 0032 reserved for #997 (PR #1016).
CREATE TABLE "coupon_redemptions" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"coupon_id" uuid NOT NULL,
	"workspace_id" uuid NOT NULL,
	"plan_key" varchar(40) NOT NULL,
	"interval" varchar(10) NOT NULL,
	"redeemed_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "coupons" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"code" varchar(40) NOT NULL,
	"kind" varchar(8) NOT NULL,
	"value" integer NOT NULL,
	"currency" varchar(3),
	"duration" varchar(10) NOT NULL,
	"duration_months" integer,
	"expires_at" timestamp with time zone,
	"max_redemptions" integer,
	"paused_at" timestamp with time zone,
	"restrict_plan_keys" varchar(255),
	"restrict_interval" varchar(10),
	"provider_offer_id" varchar(255),
	"created_by_id" uuid,
	"created_by_label" varchar(255),
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "plans" ADD COLUMN "trial_days" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "plans" ADD COLUMN "trial_requires_card" integer DEFAULT 1 NOT NULL;--> statement-breakpoint
ALTER TABLE "coupon_redemptions" ADD CONSTRAINT "coupon_redemptions_coupon_id_coupons_id_fk" FOREIGN KEY ("coupon_id") REFERENCES "public"."coupons"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "coupon_redemptions" ADD CONSTRAINT "coupon_redemptions_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "coupons" ADD CONSTRAINT "coupons_created_by_id_users_id_fk" FOREIGN KEY ("created_by_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "coupon_redemptions_coupon_workspace_key" ON "coupon_redemptions" USING btree ("coupon_id","workspace_id");--> statement-breakpoint
CREATE INDEX "coupon_redemptions_coupon_idx" ON "coupon_redemptions" USING btree ("coupon_id");--> statement-breakpoint
CREATE UNIQUE INDEX "coupons_code_key" ON "coupons" USING btree (lower("code"));