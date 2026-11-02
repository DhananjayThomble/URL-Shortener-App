-- Down migration for 0032_feedback (#997).
--
-- drizzle-kit's migrator is forward-only (it tracks applied migrations in
-- __drizzle_migrations and never runs a down), so this file is not executed
-- automatically. It is kept beside the up migration as the authoritative,
-- reviewed reverse: 0032 only CREATED the feedback table (and its indexes and
-- foreign keys), nothing else references it, so dropping the table leaves the
-- schema byte-identical to before 0032.
--
-- To roll back by hand: delete the 0032 row from __drizzle_migrations (so the
-- migrator does not think it is still applied) and run the statement below.

DROP TABLE IF EXISTS "feedback";
