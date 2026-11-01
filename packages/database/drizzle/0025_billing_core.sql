CREATE TABLE "billing_events" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"provider_event_id" varchar(255) NOT NULL,
	"provider" varchar(20) NOT NULL,
	"event_type" varchar(80) NOT NULL,
	"workspace_id" uuid,
	"payload" jsonb NOT NULL,
	"processed_at" timestamp with time zone,
	"received_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "payments" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"provider" varchar(20) NOT NULL,
	"provider_payment_id" varchar(255) NOT NULL,
	"provider_subscription_id" varchar(255),
	"amount" text NOT NULL,
	"currency" varchar(3) NOT NULL,
	"status" varchar(20) NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "subscriptions" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"plan_key" varchar(40) NOT NULL,
	"interval" varchar(10) NOT NULL,
	"provider" varchar(20) NOT NULL,
	"provider_subscription_id" varchar(255),
	"provider_customer_id" varchar(255),
	"status" varchar(20) NOT NULL,
	"current_period_end" timestamp with time zone,
	"cancel_at_period_end" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "billing_events" ADD CONSTRAINT "billing_events_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payments" ADD CONSTRAINT "payments_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "subscriptions" ADD CONSTRAINT "subscriptions_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "billing_events_provider_event_key" ON "billing_events" USING btree ("provider","provider_event_id");--> statement-breakpoint
CREATE INDEX "billing_events_workspace_idx" ON "billing_events" USING btree ("workspace_id");--> statement-breakpoint
CREATE UNIQUE INDEX "payments_provider_payment_key" ON "payments" USING btree ("provider","provider_payment_id");--> statement-breakpoint
CREATE INDEX "payments_workspace_idx" ON "payments" USING btree ("workspace_id");--> statement-breakpoint
CREATE UNIQUE INDEX "subscriptions_workspace_key" ON "subscriptions" USING btree ("workspace_id");--> statement-breakpoint
CREATE UNIQUE INDEX "subscriptions_provider_sub_key" ON "subscriptions" USING btree ("provider_subscription_id") WHERE "subscriptions"."provider_subscription_id" is not null;