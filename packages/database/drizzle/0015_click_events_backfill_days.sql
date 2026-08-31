/* ============================================================
   click_events_backfill_days: move the historical provisioning
   loop OUT of a single schema transaction.

   The problem this fixes (issue #294). Migration 0007's `DO $mig$`
   block provisioned one partition per day for the whole history
   of the table — least(min(occurred_at)::date, today-7) through
   greatest(max(occurred_at)::date, today+14) — and then copied
   every legacy row across, all inside the one transaction drizzle
   wraps each migration file in. Three properties made that a
   scheduled event rather than a routine migration:

     - It is a single transaction, so the initial
       `ALTER TABLE click_events RENAME TO click_events_legacy`
       takes ACCESS EXCLUSIVE and holds it through the entire
       per-day loop, the full-table copy and the final DROP. Every
       click insert blocks for the whole duration.

     - Its blast radius is wider than click_events: the two
       ADD CONSTRAINT ... FOREIGN KEY statements take
       SHARE ROW EXCLUSIVE on links and workspaces to commit, so
       nobody can create or edit a link either.

     - Its lock footprint scales with history. Each attached
       partition contributes its own relation plus four cloned
       indexes — roughly five lock slots per day. The shared lock
       table is max_locks_per_transaction * (max_connections +
       max_prepared_transactions), 6400 on a default config, so
       ~3.5 years of history approaches the ceiling and more
       exceeds it, aborting the whole migration with
       `out of shared memory`.

   Why 0007 is not simply rewritten. 0007 has already been applied
   in every deployment (idx 7 in meta/_journal.json) and migrations
   0008-0014 build on it. Editing an applied migration's SQL breaks
   drizzle's checksum on every deployed database. click_events has
   never carried data in any deployment, so 0007's history loop is
   a no-op everywhere today. The fix is therefore forward-only: a
   helper that lets a self-hoster who adopts this schema WITH
   pre-existing legacy rows do the historical provisioning outside
   a single transaction, committing between bounded chunks.

   What this function does. Given a chunk size, it finds day-
   partitions the current data needs but which are NOT yet
   attached — derived from the distinct occurred_at days currently
   sitting in the DEFAULT partition (click_events_default) — and
   calls the existing click_events_ensure_partition(d) for up to
   `chunk_size` of them, oldest first. It RETURNS how many days it
   provisioned this call and how many candidate days still remain,
   so a caller can loop and COMMIT between chunks. It deliberately
   does NOT loop over the whole history in one statement: the whole
   point of #294 is that the caller commits between chunks so no
   single transaction accumulates a history-sized lock footprint.

   Why the DEFAULT partition is the source of candidate days.
   0007 creates click_events_default as a catch-all so an insert
   for an unprovisioned day can never fail — it lands in DEFAULT
   and a later click_events_ensure_partition pass drains it into a
   dated partition. That same machinery is what makes decoupled
   backfill correct: a self-hoster's legacy rows for unprovisioned
   days land in DEFAULT, and this function drains them out one
   bounded chunk at a time. It reuses click_events_ensure_partition
   verbatim (already idempotent, already bounded to a 2s
   lock_timeout, and it is what performs the DEFAULT drain + ATTACH
   correctly) rather than reinventing any provisioning logic.

   No-op on a fresh install. A fresh install has no historical
   rows, so click_events_default is empty and this function finds
   no candidate days and provisions nothing. Fresh installs do NOT
   backfill history: old days are handled lazily by the DEFAULT
   partition plus the worker's existing ensureClickPartitions
   window, and this function is only needed by an operator adopting
   the schema with pre-existing legacy data. Idempotent by
   construction: a day that is already attached is not a candidate,
   and click_events_ensure_partition is itself a no-op on an
   already-attached day.
   ============================================================ */

CREATE OR REPLACE FUNCTION click_events_backfill_days(chunk_size int DEFAULT 200)
RETURNS TABLE(provisioned int, remaining int)
LANGUAGE plpgsql
AS $fn$
DECLARE
	d date;
	part text;
	done int := 0;
BEGIN
	/* A non-positive chunk would make the caller's loop spin without ever
	   provisioning anything, so treat it as the default rather than trusting it.
	   The point of the knob is to BOUND a chunk, never to disable progress. */
	IF chunk_size IS NULL OR chunk_size < 1 THEN
		chunk_size := 200;
	END IF;

	/* Candidate days: distinct UTC days that have rows stranded in the DEFAULT
	   partition but no dated partition attached for them yet. The NOT EXISTS is
	   what makes `done` count real work rather than already-attached days that
	   happen to hold a stray DEFAULT row, and it keeps this loop's selection
	   identical to the `remaining` recount below. Oldest first, so a
	   repeatedly-interrupted backfill still makes monotonic forward progress from
	   the far end of history.

	   `at time zone 'UTC'` rather than ::date in the session TimeZone: every
	   bound in 0007 is built AT TIME ZONE 'UTC', and mixing the two files a click
	   under the wrong day. FROM ONLY click_events_default so this reads just the
	   catch-all, not the whole partitioned table. Bounded by chunk_size here so
	   this statement itself never enumerates all of history — the caller commits
	   and calls again for the rest. */
	FOR d IN
		SELECT day FROM (
			SELECT DISTINCT (occurred_at AT TIME ZONE 'UTC')::date AS day
			FROM ONLY "click_events_default"
		) days
		WHERE NOT EXISTS (
			SELECT 1 FROM pg_inherits i
			JOIN pg_class c ON c.oid = i.inhrelid
			WHERE i.inhparent = 'public.click_events'::regclass
			  AND c.relname = 'click_events_' || to_char(days.day, 'YYYYMMDD')
		)
		ORDER BY day
		LIMIT chunk_size
	LOOP
		/* Reuse the existing provisioner. It is idempotent, drains the DEFAULT
		   partition for the day and attaches the dated partition, and bounds its
		   own locks to 2s — declining (returning NULL) rather than stalling the
		   redirect path if write traffic holds the lock. A declined day simply
		   stays a candidate for the next chunk, so progress is never lost.

		   Counted only when it actually attached (non-NULL return), NOT merely
		   attempted. This is what lets the caller detect "no forward progress":
		   if every candidate this chunk was contended, `provisioned` is zero and
		   the caller stops re-attempting rather than spinning on days a burst of
		   write traffic is currently holding — a later manual run picks them up
		   once the contention clears. */
		part := click_events_ensure_partition(d);
		IF part IS NOT NULL THEN
			done := done + 1;
		END IF;
	END LOOP;

	/* Remaining candidate days AFTER this chunk, so the caller knows whether to
	   loop again. Recomputed rather than derived by subtraction because a
	   declined day above is still stranded in DEFAULT and must be retried, and
	   because concurrent inserts can strand new days between statements. When
	   this reaches zero the DEFAULT partition holds no rows for any unattached
	   day and the backfill is complete. */
	SELECT count(*)::int INTO remaining
	FROM (
		SELECT DISTINCT (occurred_at AT TIME ZONE 'UTC')::date AS day
		FROM ONLY "click_events_default"
	) days
	WHERE NOT EXISTS (
		SELECT 1 FROM pg_inherits i
		JOIN pg_class c ON c.oid = i.inhrelid
		WHERE i.inhparent = 'public.click_events'::regclass
		  AND c.relname = 'click_events_' || to_char(days.day, 'YYYYMMDD')
	);

	provisioned := done;
	RETURN NEXT;
END;
$fn$;
