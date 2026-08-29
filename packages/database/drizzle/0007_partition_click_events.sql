/* ============================================================
   click_events becomes RANGE-partitioned by occurred_at, one
   partition per UTC day.

   Why: at 1,000 clicks/second this table takes ~86M rows a day.
   Two things break at that volume, and both are fixed by the
   same change.

   1. Retention. pruneRetention deleted rows by age, which at
      this size generates WAL faster than a replica can consume
      it, bloats the heap, and outruns autovacuum. Dropping a
      whole partition is constant-time and produces almost no
      WAL.

   2. Index size. click_events_link_time_idx was one btree over
      every row ever recorded. Per-partition indexes stay
      resident in memory.

   Drizzle has no vocabulary for partitioning, so this file is
   hand-written. The generated diff was only the primary-key
   change; the constraint name below is drizzle's, so that a
   future `drizzle-kit generate` sees no drift.

   Day boundaries are explicitly UTC, matching the rollups,
   which all aggregate on (occurred_at at time zone 'UTC')::date.
   Using date::timestamptz would silently adopt the session
   TimeZone and put a click in the wrong day for anyone east of
   Greenwich.
   ============================================================ */

-- Move the old table aside rather than dropping it: a deployed database has
-- rows in here, and they are copied into the new partitions below.
ALTER TABLE "click_events" RENAME TO "click_events_legacy";--> statement-breakpoint

-- Index names are unique per schema, so the old ones have to go before the new
-- table can claim them. They are not needed in between — the copy below is a
-- single sequential read.
DROP INDEX IF EXISTS "click_events_link_time_idx";--> statement-breakpoint
DROP INDEX IF EXISTS "click_events_workspace_time_idx";--> statement-breakpoint
DROP INDEX IF EXISTS "click_events_pending_idx";--> statement-breakpoint

CREATE TABLE "click_events" (
	"id" uuid DEFAULT uuidv7() NOT NULL,
	"link_id" uuid NOT NULL,
	"workspace_id" uuid NOT NULL,
	"occurred_at" timestamp with time zone NOT NULL,
	"visitor_hash" varchar(32) NOT NULL,
	"country" varchar(2),
	"city" varchar(100),
	"device" varchar(10),
	"browser" varchar(40),
	"os" varchar(20),
	"referrer_host" varchar(253),
	"is_qr" boolean DEFAULT false NOT NULL,
	"is_bot" boolean DEFAULT false NOT NULL,
	"blocked_reason" varchar(30),
	"matched_rule_id" uuid,
	"variant" varchar(12),
	"rolled_up_at" timestamp with time zone,
	-- Postgres requires the partition key in every unique constraint on a
	-- partitioned table, so this cannot be "id" alone.
	CONSTRAINT "click_events_id_occurred_at_pk" PRIMARY KEY("id","occurred_at")
) PARTITION BY RANGE ("occurred_at");--> statement-breakpoint

ALTER TABLE "click_events" ADD CONSTRAINT "click_events_link_id_links_id_fk" FOREIGN KEY ("link_id") REFERENCES "public"."links"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "click_events" ADD CONSTRAINT "click_events_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint

-- Declared on the parent, which propagates them to every partition, existing
-- and future. A partition attached later inherits these automatically.
CREATE INDEX "click_events_link_time_idx" ON "click_events" USING btree ("link_id","occurred_at" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "click_events_workspace_time_idx" ON "click_events" USING btree ("workspace_id","occurred_at" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "click_events_pending_idx" ON "click_events" USING btree ("occurred_at") WHERE "rolled_up_at" is null;--> statement-breakpoint

/* The safety net.

   Without a DEFAULT partition, an insert whose day has no partition fails —
   which would mean losing clicks because a maintenance job did not run. The
   redirect path must never be able to fail for a housekeeping reason.

   Under normal operation this stays empty, because the worker provisions days
   ahead of time. click_events_ensure_partition below drains it when it is not,
   so a worker outage costs nothing but a slower query until it catches up. */
CREATE TABLE "click_events_default" PARTITION OF "click_events" DEFAULT;--> statement-breakpoint

/* Create one day's partition, idempotently.

   The ordering here is the whole trick. The new partition is built detached,
   any rows that already landed in the default partition for that day are moved
   into it, and only then is it attached. Attaching first would fail: Postgres
   scans the default partition and refuses the ATTACH if any row there would
   belong to the incoming range. That is the standard trap with default
   partitions, and it is why a naive CREATE TABLE ... PARTITION OF is not
   enough once the default has ever been used. */
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
	/* Attached, not merely existing.
	   A previous call may have created the table and then failed to attach it
	   (see the lock_timeout below), and treating that as done would leave a
	   permanently orphaned table while the day's rows piled into the default. */
	IF EXISTS (
		SELECT 1 FROM pg_inherits i
		JOIN pg_class c ON c.oid = i.inhrelid
		WHERE i.inhparent = 'public.click_events'::regclass AND c.relname = part_name
	) THEN
		RETURN part_name;
	END IF;

	/* One provisioner at a time. Reserved concurrency allows two worker
	   instances and EventBridge retries on top of that, so two passes racing on
	   the same day is ordinary rather than exotic. Transaction-scoped and
	   re-entrant within a session, so a single pass looping over a fortnight of
	   days takes it once. */
	IF NOT pg_try_advisory_xact_lock(hashtext('click_events_ensure_partition')) THEN
		RETURN NULL;
	END IF;

	/* An orphan from an earlier attempt whose ATTACH timed out. Reuse it only if
	   its columns still match the parent: ALTER TABLE ... ADD COLUMN on a
	   partitioned table does not reach a detached table, so an orphan that
	   survives a later column-adding migration would fail ATTACH with
	   datatype_mismatch on every pass forever, and the only repair would be
	   dropping it by hand. Dropping it here costs nothing — a caught exception
	   rolls its drain back with it, so an orphan is always empty. */
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

	EXECUTE format(
		'CREATE TABLE IF NOT EXISTS %I (LIKE "click_events" INCLUDING DEFAULTS INCLUDING CONSTRAINTS)',
		part_name
	);

	/* ATTACH takes an ACCESS EXCLUSIVE lock on the DEFAULT partition, because it
	   has to prove no row there belongs to the incoming range. That conflicts
	   with every concurrent insert, and the redirect path inserts continuously.
	
	   Waiting on that lock is the wrong trade twice over: it stalls the hot
	   path, and it can deadlock against a writer that already holds a row lock
	   in the partition being scanned. So the wait is bounded and failure is not
	   an error — provisioning is an optimisation, and the DEFAULT partition is
	   what actually guarantees an insert cannot fail. A day we could not attach
	   now is attached by a later pass; in the meantime its rows land in the
	   default and are drained when it succeeds.
	
	   In steady state this contends with nothing, because a day is provisioned
	   about a fortnight before any row targets it, so the default holds no rows
	   in its range and the scan is trivial. */
	prev_timeout := current_setting('lock_timeout');
	SET LOCAL lock_timeout = '2s';

	BEGIN
		/* Take the lock BEFORE draining, not as a side effect of ATTACH.
		
		   Draining first leaves a window: a click for this day that commits
		   between the drain and the ATTACH routes to the default (its partition
		   is not attached yet), and the ATTACH's validation scan then finds it
		   and fails with check_violation. That is not a corner case — draining
		   only matters when the default already holds rows for this day, which
		   means the day is live and traffic is still arriving for it.
		
		   Locking first also stops the drain being wasted work: previously a
		   large backlog was copied at full WAL cost and then rolled back when
		   the ATTACH could not get its lock, repeating every pass with no
		   progress. */
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
			-- 42809: already a partition of the parent. Another pass won the
			-- race on this day, which is the outcome we wanted anyway.
			NULL;
		WHEN check_violation OR datatype_mismatch OR invalid_object_definition THEN
			/* 23514 a row slipped into the default despite the lock, 42804 the
			   candidate is schema-incompatible, 42P17 the range overlaps. None
			   is recoverable here, and none is worth aborting the caller for:
			   ensureClickPartitions runs first in the maintenance pass, so
			   raising would skip salt rotation and every prune behind it. */
			EXECUTE format('SET LOCAL lock_timeout = %L', prev_timeout);
			RETURN NULL;
	END;

	/* Restored rather than left set: SET LOCAL persists to the end of the
	   caller's transaction, and the migration below calls this function in the
	   same transaction as the full-table copy and the legacy DROP. A 2s lock
	   timeout leaking onto those would abort the migration on a live database. */
	EXECUTE format('SET LOCAL lock_timeout = %L', prev_timeout);

	RETURN part_name;
END;
$fn$;--> statement-breakpoint

/* Retention, as a partition drop rather than a DELETE.

   A partition is only dropped when its entire range is behind the cutoff, so
   there is never a partially-expired partition to reason about. The day is read
   off the partition name, which this schema owns, rather than parsed out of the
   bound expression — same answer, far less to get wrong.

   The default partition is deliberately never dropped. It is part of the
   table's structure, and anything sitting in it is by definition outside every
   known day. */
CREATE OR REPLACE FUNCTION click_events_spent_partitions(cutoff date)
RETURNS SETOF text
LANGUAGE plpgsql
AS $fn$
DECLARE
	part record;
	unrolled boolean;
BEGIN
	FOR part IN
		SELECT c.relname
		FROM pg_class c
		JOIN pg_inherits i ON i.inhrelid = c.oid
		WHERE i.inhparent = 'public.click_events'::regclass
		  AND c.relname ~ '^click_events_[0-9]{8}$'
		ORDER BY c.relname
	LOOP
		-- Partition covers [day, day + 1), so it is spent once day + 1 has
		-- reached the cutoff. Never a partially-expired partition to reason about.
		CONTINUE WHEN to_date(right(part.relname, 8), 'YYYYMMDD') + 1 > cutoff;

		/* The invariant the row-level DELETE used to carry: raw detail is never
		   discarded before it has been counted. Dropping a partition that still
		   holds un-rolled-up clicks would lose them from click_events *and* from
		   the rollups at once, and nothing would report it — the dashboards
		   would simply under-count forever. Cheap to check: click_events_pending_idx
		   is a partial index on exactly this predicate. */
		EXECUTE format('SELECT EXISTS (SELECT 1 FROM ONLY %I WHERE rolled_up_at IS NULL)', part.relname)
		INTO unrolled;
		CONTINUE WHEN unrolled;

		RETURN NEXT part.relname;
	END LOOP;
END;
$fn$;--> statement-breakpoint

/* Drop exactly one spent partition, and never wait long to do it.
	
   DETACH takes an ACCESS EXCLUSIVE lock on the **parent**, not just on the
   partition, so while it is held every insert into every other partition blocks
   too. DETACH CONCURRENTLY is not available, precisely because this table has a
   DEFAULT partition — the safety net that makes an insert unfailable is also
   what forecloses the low-lock detach.
	
   So this handles one partition per call and the caller loops, giving each its
   own transaction and releasing the parent lock in between. Returns false if it
   could not get the lock in time, which the caller treats as "try again next
   pass" rather than as an error. */
CREATE OR REPLACE FUNCTION click_events_drop_partition(part_name text)
RETURNS boolean
LANGUAGE plpgsql
AS $fn$
DECLARE
	prev_timeout text;
BEGIN
	IF part_name !~ '^click_events_[0-9]{8}$' THEN
		RAISE EXCEPTION 'refusing to drop %', part_name;
	END IF;

	prev_timeout := current_setting('lock_timeout');
	SET LOCAL lock_timeout = '2s';

	BEGIN
		EXECUTE format('ALTER TABLE "click_events" DETACH PARTITION %I', part_name);
		EXECUTE format('DROP TABLE %I', part_name);
	EXCEPTION
		WHEN lock_not_available OR deadlock_detected THEN
			EXECUTE format('SET LOCAL lock_timeout = %L', prev_timeout);
			RETURN false;
		WHEN undefined_table THEN
			-- A concurrent pass already dropped it. Idempotent by intent.
			EXECUTE format('SET LOCAL lock_timeout = %L', prev_timeout);
			RETURN false;
	END;

	EXECUTE format('SET LOCAL lock_timeout = %L', prev_timeout);
	RETURN true;
END;
$fn$;--> statement-breakpoint

/* Provision the days the existing rows need, a week behind, and a fortnight
   ahead.
	
   The window matters, not just its size. This migration runs with no concurrent
   writers, so it is the one moment a past day can be attached cheaply — and a
   past day is the expensive case, because rows for it may already sit in the
   DEFAULT partition and ATTACH has to scan and lock it. Leaving the recent past
   unprovisioned means the worker's first pass tries to attach yesterday while
   the redirect path is inserting into it, which is precisely the contention the
   bounded lock_timeout above exists to bail out of. Doing it here instead means
   the worker only ever attaches empty future days. */
DO $mig$
DECLARE
	d date;
	today date;
	first_day date;
	last_day date;
BEGIN
	SELECT (min("occurred_at") AT TIME ZONE 'UTC')::date,
	       (max("occurred_at") AT TIME ZONE 'UTC')::date
	INTO first_day, last_day
	FROM "click_events_legacy";

	-- UTC, not current_date: every bound above is built with AT TIME ZONE 'UTC',
	-- and current_date resolves in the session TimeZone. Mixing the two is the
	-- bug this file's header warns about.
	today := (now() AT TIME ZONE 'UTC')::date;
	first_day := least(coalesce(first_day, today), today - 7);
	last_day  := greatest(coalesce(last_day, today), today + 14);

	d := first_day;
	WHILE d <= last_day LOOP
		PERFORM click_events_ensure_partition(d);
		d := d + 1;
	END LOOP;
END;
$mig$;--> statement-breakpoint

-- Columns listed explicitly: the legacy table's physical order has city last,
-- because it arrived in 0004. SELECT * would line it up against the wrong
-- column in the new table.
INSERT INTO "click_events" (
	"id", "link_id", "workspace_id", "occurred_at", "visitor_hash",
	"country", "city", "device", "browser", "os", "referrer_host",
	"is_qr", "is_bot", "blocked_reason", "matched_rule_id", "variant",
	"rolled_up_at"
)
SELECT
	"id", "link_id", "workspace_id", "occurred_at", "visitor_hash",
	"country", "city", "device", "browser", "os", "referrer_host",
	"is_qr", "is_bot", "blocked_reason", "matched_rule_id", "variant",
	"rolled_up_at"
FROM "click_events_legacy";--> statement-breakpoint

DROP TABLE "click_events_legacy";
