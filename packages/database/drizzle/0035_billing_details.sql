CREATE TABLE "workspace_billing_details" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"billing_email" varchar(255),
	"company_name" varchar(200),
	"tax_id" varchar(40),
	"address_line1" varchar(200),
	"address_line2" varchar(200),
	"city" varchar(120),
	"state" varchar(120),
	"postal_code" varchar(20),
	"country" varchar(2),
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "subscriptions" ADD COLUMN "cancellation_reason" varchar(24);--> statement-breakpoint
ALTER TABLE "subscriptions" ADD COLUMN "cancellation_comment" text;--> statement-breakpoint
ALTER TABLE "workspace_billing_details" ADD CONSTRAINT "workspace_billing_details_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "workspace_billing_details_workspace_key" ON "workspace_billing_details" USING btree ("workspace_id");