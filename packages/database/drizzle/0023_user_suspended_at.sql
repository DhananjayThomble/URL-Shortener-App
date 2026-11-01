-- #969 — platform-admin user suspension.
--
-- Adds users.suspended_at: null for an active account, a timestamp for a
-- suspended one. Purely additive and nullable, so it is backfill-free and
-- applies online without rewriting the table. The admin API is the only thing
-- that sets or clears it; the auth paths read it to refuse a suspended user.
ALTER TABLE "users" ADD COLUMN "suspended_at" timestamp with time zone;
