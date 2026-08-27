ALTER TABLE "domains" ALTER COLUMN "workspace_id" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "domains" ADD COLUMN "is_system" boolean DEFAULT false NOT NULL;