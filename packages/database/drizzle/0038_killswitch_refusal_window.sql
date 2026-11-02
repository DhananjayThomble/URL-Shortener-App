CREATE TABLE "kill_switch_refusal_window" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"dedupe_key" varchar(320) NOT NULL,
	"switch_key" varchar(64) NOT NULL,
	"reason" varchar(24) NOT NULL,
	"workspace_id" uuid,
	"actor_id" uuid,
	"count" integer DEFAULT 1 NOT NULL,
	"first_at" timestamp with time zone DEFAULT now() NOT NULL,
	"last_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "kill_switch_refusal_window_dedupe_key_unique" UNIQUE("dedupe_key")
);
--> statement-breakpoint
CREATE INDEX "kill_switch_refusal_window_first_at_idx" ON "kill_switch_refusal_window" USING btree ("first_at");