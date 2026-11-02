CREATE TABLE "email_send_log" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"sent_at" timestamp with time zone DEFAULT now() NOT NULL,
	"auth_critical" boolean DEFAULT false NOT NULL
);
--> statement-breakpoint
CREATE INDEX "email_send_log_sent_at_idx" ON "email_send_log" USING btree ("sent_at" DESC NULLS LAST);