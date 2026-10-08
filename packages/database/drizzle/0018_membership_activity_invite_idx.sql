ALTER TABLE "memberships" ADD COLUMN "last_active_at" timestamp with time zone;--> statement-breakpoint
CREATE INDEX "memberships_invite_token_hash_idx" ON "memberships" USING btree ("invite_token_hash") WHERE "memberships"."invite_token_hash" is not null;--> statement-breakpoint
-- #699 backfill: a person with exactly one active membership was, by
-- construction, active only in that workspace, so the account-wide stamp is
-- exact for them. Anyone in more than one starts empty rather than leaking
-- activity from another workspace; the next GET /auth/me fills it in.
UPDATE "memberships" m
SET "last_active_at" = u."last_active_at"
FROM "users" u
WHERE m."user_id" = u."id"
  AND m."status" = 'active'
  AND u."last_active_at" IS NOT NULL
  AND (SELECT count(*) FROM "memberships" o WHERE o."user_id" = m."user_id" AND o."status" = 'active') = 1;
