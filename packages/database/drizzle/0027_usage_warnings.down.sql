-- Down migration for 0027_usage_warnings (#970).
--
-- drizzle-kit's migrator is forward-only, so this file is not executed
-- automatically. It is the authoritative, reviewed reverse: 0027 ADDED one
-- table, so dropping it leaves the schema byte-identical to before. Safe
-- because nothing else references usage_warnings.
--
-- To roll back by hand: delete the 0027 row from __drizzle_migrations and run
-- the statement below.
DROP TABLE IF EXISTS "usage_warnings";
