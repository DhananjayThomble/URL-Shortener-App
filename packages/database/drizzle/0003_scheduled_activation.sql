ALTER TABLE "links" ADD COLUMN "activates_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "links" ADD COLUMN "scheduled_to" text;--> statement-breakpoint
CREATE INDEX "links_activates_idx" ON "links" USING btree ("activates_at") WHERE "links"."activates_at" is not null;