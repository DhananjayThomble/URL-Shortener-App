/* ============================================================
   click_events_drop_partition now decides for itself whether a
   partition still holds un-rolled-up clicks.

   Both callers used to check that separately, in an earlier
   statement, and then call this function. That left two
   problems.

   The reachable one: the cap loop in pruneRetention read a list
   of partition names in one statement and probed each in the
   next, with

     select exists (select 1 from only "<part>" where rolled_up_at is null)

   built by string interpolation. A concurrent pass dropping that
   partition in between made the probe raise undefined_table,
   which nothing caught — unlike this function, which has always
   treated a missing partition as "somebody else got there
   first". The throw escaped pruneRetention and took the rest of
   the maintenance pass with it.

   That became reachable only recently. Retention used to be
   guarded by a session-scoped advisory lock that never expired,
   so two passes could not overlap; the failure mode was "nobody
   runs it", not "two run at once". Replacing it with an expiring
   lease deliberately allows a lapsed pass to be overtaken, which
   is what turned the probe into a live path.

   The quieter one: even a to_regclass guard would only narrow
   the window, because the check and the drop were still separate
   statements. Moving the check inside means it runs *after* the
   partition is locked, so a row cannot arrive between deciding
   and dropping.

   Returning false rather than raising when rows are pending
   matches what the callers already did with a pending partition:
   skip it, leave it attached, and do not count it as dropped. So
   the observable behaviour is unchanged — it simply can no
   longer explode. Distinguishing "pending" from "lock timeout"
   from "already gone" is #324's job, not this migration's.
   ============================================================ */

CREATE OR REPLACE FUNCTION click_events_drop_partition(part_name text)
RETURNS boolean
LANGUAGE plpgsql
AS $fn$
DECLARE
	prev_timeout text;
	has_pending boolean;
BEGIN
	IF part_name !~ '^click_events_[0-9]{8}$' THEN
		RAISE EXCEPTION 'refusing to drop %', part_name;
	END IF;

	prev_timeout := current_setting('lock_timeout');
	SET LOCAL lock_timeout = '2s';

	BEGIN
		/* Lock the parent first, then the partition. The order is the whole
		   point, not an accident of writing.
		
		   Every other route to a partition reaches it *through* click_events —
		   the rollup's batch claim, its marker UPDATE, the row-level retention
		   DELETE — so they all take their locks parent-then-child. Locking the
		   partition first would put this function in the opposite order and close
		   a genuine deadlock cycle against any of them. Worse, the other side
		   starts waiting one step earlier, so its deadlock_timeout fires first
		   and *it* is the process Postgres kills: the visible symptom would be a
		   failed rollup, not a failed drop, and the handler below would never
		   see it.
		
		   ONLY matters. Without it, LOCK TABLE on a partitioned table descends to
		   every partition, which is a far heavier lock than this needs and would
		   block inserts routing to today while an ancient day is dropped.
		
		   Holding the parent exclusively is also what makes the probe below
		   trustworthy: no insert can route a row into this partition between
		   deciding and dropping. DETACH requires this lock anyway, so the only
		   thing changed by taking it up front is the order. */
		EXECUTE 'LOCK TABLE ONLY "click_events" IN ACCESS EXCLUSIVE MODE';
		EXECUTE format('LOCK TABLE %I IN ACCESS EXCLUSIVE MODE', part_name);

		/* Raw detail is never discarded before it has been counted. Dropping a
		   partition that still holds un-rolled-up clicks would lose them from
		   click_events *and* from the rollups at once, and nothing would report
		   it — the dashboards would simply under-count for ever.

		   FROM ONLY plus the rolled_up_at IS NULL predicate hits the partial
		   click_events_pending_idx, so this is an index probe rather than a
		   scan. part_name is regex-validated above, so the format() cannot
		   inject. */
		EXECUTE format(
			'SELECT EXISTS (SELECT 1 FROM ONLY %I WHERE rolled_up_at IS NULL)',
			part_name
		) INTO has_pending;

		IF has_pending THEN
			EXECUTE format('SET LOCAL lock_timeout = %L', prev_timeout);
			RETURN false;
		END IF;

		EXECUTE format('ALTER TABLE "click_events" DETACH PARTITION %I', part_name);
		EXECUTE format('DROP TABLE %I', part_name);
	EXCEPTION
		WHEN lock_not_available OR deadlock_detected THEN
			EXECUTE format('SET LOCAL lock_timeout = %L', prev_timeout);
			RETURN false;
		WHEN undefined_table THEN
			-- A concurrent pass already dropped it. Idempotent by intent, and now
			-- this also covers the LOCK and the pending probe above.
			EXECUTE format('SET LOCAL lock_timeout = %L', prev_timeout);
			RETURN false;
	END;

	EXECUTE format('SET LOCAL lock_timeout = %L', prev_timeout);
	RETURN true;
END;
$fn$;
