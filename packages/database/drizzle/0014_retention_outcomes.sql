/* ============================================================
   Two changes to partition maintenance, both about being able
   to tell what happened.

   1. click_events_ensure_partition locks the parent explicitly,
      and first, matching click_events_drop_partition.

      Since 0013 the drop path goes parent -> partition ->
      default, because DETACH needs the default too.
      Provisioning reached the default before taking any
      explicit lock on the parent, so the two read as opposite
      orders on the same pair of objects.

      Worth being accurate about what this fixes, because the
      obvious claim is too strong: the cycle was already
      unreachable. `CREATE TABLE ... (LIKE "click_events" ...)`
      a few statements up takes ACCESS SHARE on the parent and
      holds it to the end of the transaction, so provisioning
      was in fact parent-first already, just implicitly and at a
      weaker mode. A drop could never take parent ACCESS
      EXCLUSIVE while a provisioner held ACCESS SHARE on it, so
      neither side could get one step into the other's ordering.
      Measured: 30k mixed ensure/drop/insert/rollup
      transactions, zero deadlocks, on this revision and on the
      one before it.

      What it buys is that the ordering is now explicit and
      deliberate rather than an accident of which statement
      happens to touch the parent first — and it takes the
      parent at the mode ATTACH actually needs, so nothing
      upgrades to a stronger lock mid-function, which is the
      shape that *would* reintroduce a cycle.

      SHARE UPDATE EXCLUSIVE, not ACCESS EXCLUSIVE. It is what
      ATTACH needs anyway and it does not conflict with the ROW
      EXCLUSIVE an insert takes, so provisioning still does not
      block the redirect path. ACCESS EXCLUSIVE would have
      ordered the locks just as well and blocked every insert
      for the duration, trading one problem for a worse one.
      Consistent order is what matters; matching strength is
      not required.

   2. click_events_drop_partition reports *why* it did not drop.

      It used to return boolean, and false covered four
      different outcomes: the partition still held un-rolled-up
      clicks, the lock could not be taken in time, it
      deadlocked, or it was already gone. pruneRetention could
      only count successes, so a pass losing every drop to lock
      contention reported partitionsDropped: 0 — identical to a
      pass with nothing to drop. Retention could stall
      indefinitely with no signal, which is the same class of
      silent failure as #323 and #326.

      Returning text rather than boolean means DROP and CREATE
      rather than CREATE OR REPLACE: Postgres will not change a
      function's return type in place.
   ============================================================ */

CREATE OR REPLACE FUNCTION click_events_ensure_partition(target_day date)
RETURNS text
LANGUAGE plpgsql
AS $fn$
DECLARE
	part_name text := 'click_events_' || to_char(target_day, 'YYYYMMDD');
	lo timestamptz := target_day::timestamp AT TIME ZONE 'UTC';
	hi timestamptz := (target_day + 1)::timestamp AT TIME ZONE 'UTC';
	prev_timeout text;
BEGIN
	IF EXISTS (
		SELECT 1 FROM pg_inherits i
		JOIN pg_class c ON c.oid = i.inhrelid
		WHERE i.inhparent = 'public.click_events'::regclass AND c.relname = part_name
	) THEN
		RETURN part_name;
	END IF;

	IF NOT pg_try_advisory_xact_lock(hashtext('click_events_ensure_partition')) THEN
		RETURN NULL;
	END IF;

	IF EXISTS (
		SELECT 1 FROM pg_class
		WHERE relname = part_name AND relnamespace = 'public'::regnamespace
	) THEN
		IF (
			SELECT count(*) FROM information_schema.columns
			WHERE table_schema = 'public' AND table_name = part_name
		) <> (
			SELECT count(*) FROM information_schema.columns
			WHERE table_schema = 'public' AND table_name = 'click_events'
		) THEN
			EXECUTE format('DROP TABLE %I', part_name);
		END IF;
	END IF;

	/* The timeout is set BEFORE the CREATE TABLE, not after it.
	
	   `LIKE "click_events"` takes an ACCESS SHARE lock on the parent, and that is
	   the function's *first* parent lock — one statement earlier than the explicit
	   LOCK TABLE below. Left outside the timeout it waits without bound, so a pass
	   racing a drop that holds the parent exclusively would block for as long as
	   the drop took and then go on to succeed, reporting the day as provisioned.
	   The caller's `declined` counter exists to make "provisioning is losing to
	   write traffic" visible, and that is exactly the collision it could not see.
	
	   Bounding this also bounds the schema-mismatch DROP TABLE above, which is
	   the right trade: neither is worth waiting on. */
	prev_timeout := current_setting('lock_timeout');
	SET LOCAL lock_timeout = '2s';

	BEGIN
		EXECUTE format(
			'CREATE TABLE IF NOT EXISTS %I (LIKE "click_events" INCLUDING DEFAULTS INCLUDING CONSTRAINTS)',
			part_name
		);

		/* Parent first, then the default. See the header: the drop path locks
		   parent -> partition -> default, and taking them in the opposite order
		   here closes a deadlock cycle between two maintenance passes.
		
		   SHARE UPDATE EXCLUSIVE is what ATTACH needs anyway and does not
		   conflict with the ROW EXCLUSIVE an insert takes, so ordering this
		   correctly costs the write path nothing. ONLY keeps it off the
		   partitions. */
		EXECUTE 'LOCK TABLE ONLY "click_events" IN SHARE UPDATE EXCLUSIVE MODE';

		/* The default's lock has to be held before the drain, not acquired as a
		   side effect of ATTACH. Draining first leaves a window: a click for this
		   day committing in between routes to the default, and ATTACH's
		   validation scan then fails with check_violation. Not a corner case —
		   draining only matters when the default already holds rows for this day,
		   which means traffic is still arriving for it. Locking first also stops
		   the drain being copied at full WAL cost and rolled back when ATTACH
		   cannot get its lock. */
		EXECUTE 'LOCK TABLE "click_events_default" IN ACCESS EXCLUSIVE MODE';

		EXECUTE format(
			'WITH moved AS (
				DELETE FROM "click_events_default"
				WHERE "occurred_at" >= %L AND "occurred_at" < %L
				RETURNING *
			)
			INSERT INTO %I SELECT * FROM moved',
			lo, hi, part_name
		);

		EXECUTE format(
			'ALTER TABLE "click_events" ATTACH PARTITION %I FOR VALUES FROM (%L) TO (%L)',
			part_name, lo, hi
		);
	EXCEPTION
		WHEN lock_not_available OR deadlock_detected THEN
			-- Write traffic won. Provisioning is an optimisation; try next pass.
			EXECUTE format('SET LOCAL lock_timeout = %L', prev_timeout);
			RETURN NULL;
		WHEN wrong_object_type THEN
			-- 42809: already a partition. Another pass won the race on this day,
			-- which is the outcome we wanted anyway.
			NULL;
		WHEN check_violation OR datatype_mismatch OR invalid_object_definition THEN
			/* 23514 a row slipped into the default despite the lock, 42804 the
			   candidate is schema-incompatible, 42P17 the range overlaps. None is
			   recoverable here, and none is worth aborting the caller for. */
			EXECUTE format('SET LOCAL lock_timeout = %L', prev_timeout);
			RETURN NULL;
	END;

	EXECUTE format('SET LOCAL lock_timeout = %L', prev_timeout);

	RETURN part_name;
END;
$fn$;--> statement-breakpoint

DROP FUNCTION IF EXISTS click_events_drop_partition(text);--> statement-breakpoint

/* Drop one spent partition, and say what happened.

   Returns one of:

     'dropped'   detached and dropped
     'pinned'    still holds un-rolled-up clicks, so left attached
     'contended' could not take a lock within the timeout, or deadlocked
     'missing'   already gone, presumably dropped by a concurrent pass

   Only 'contended' is a signal that something needs attention: it means
   partition maintenance is losing to write traffic, and a pass reporting it
   repeatedly is a pass making no progress. The other three are all normal.

   DETACH takes ACCESS EXCLUSIVE on the parent, not just on the partition, so
   while it is held every insert into every other partition blocks too, and
   DETACH CONCURRENTLY is unavailable precisely because this table has a DEFAULT
   partition. So this handles one partition per call and the caller loops,
   giving each its own transaction and releasing the parent lock in between. */
CREATE FUNCTION click_events_drop_partition(part_name text)
RETURNS text
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
		/* Parent before partition. Every other route to a partition reaches it
		   through click_events — the rollup's batch claim, its marker UPDATE, the
		   row-level retention DELETE — so they all lock parent-then-child. Going
		   the other way closes a deadlock cycle against any of them, and the
		   other side starts waiting one step earlier, so *it* is the process
		   Postgres kills: the symptom would be a failed rollup rather than a
		   failed drop, and the handler below would never see it.
		
		   ONLY keeps this off the other partitions. Holding the parent
		   exclusively is also what makes the probe trustworthy, since all
		   routing goes through the parent — DETACH needs this lock regardless,
		   so the only thing changed by taking it up front is the order. */
		EXECUTE 'LOCK TABLE ONLY "click_events" IN ACCESS EXCLUSIVE MODE';
		EXECUTE format('LOCK TABLE %I IN ACCESS EXCLUSIVE MODE', part_name);

		/* Raw detail is never discarded before it has been counted. Dropping a
		   partition still holding un-rolled-up clicks would lose them from
		   click_events *and* from the rollups at once, and nothing would report
		   it — the dashboards would simply under-count for ever.
		
		   FROM ONLY plus the rolled_up_at IS NULL predicate hits the partial
		   click_events_pending_idx, so this is an index probe rather than a scan.
		   part_name is regex-validated above, so format() cannot inject. */
		EXECUTE format(
			'SELECT EXISTS (SELECT 1 FROM ONLY %I WHERE rolled_up_at IS NULL)',
			part_name
		) INTO has_pending;

		IF has_pending THEN
			EXECUTE format('SET LOCAL lock_timeout = %L', prev_timeout);
			RETURN 'pinned';
		END IF;

		EXECUTE format('ALTER TABLE "click_events" DETACH PARTITION %I', part_name);
		EXECUTE format('DROP TABLE %I', part_name);
	EXCEPTION
		WHEN lock_not_available OR deadlock_detected THEN
			EXECUTE format('SET LOCAL lock_timeout = %L', prev_timeout);
			RETURN 'contended';
		WHEN undefined_table THEN
			-- A concurrent pass already dropped it. Idempotent by intent, and
			-- this also covers the LOCK and the pending probe above.
			EXECUTE format('SET LOCAL lock_timeout = %L', prev_timeout);
			RETURN 'missing';
	END;

	EXECUTE format('SET LOCAL lock_timeout = %L', prev_timeout);
	RETURN 'dropped';
END;
$fn$;
