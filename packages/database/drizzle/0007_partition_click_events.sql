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
BEGIN
	IF EXISTS (
		SELECT 1 FROM pg_class
		WHERE relname = part_name AND relnamespace = 'public'::regnamespace
	) THEN
		RETURN part_name;
	END IF;

	/* The check above is advisory, not a lock. Two workers running a
	   maintenance pass at the same time can both pass it for the same day —
	   reserved concurrency allows two worker instances, and EventBridge retries
	   on top of that, so this is an ordinary Tuesday rather than a corner case.
	   Losing the race is not an error worth propagating: the other pass is
	   creating exactly the partition this one wanted. */
	BEGIN
		EXECUTE format(
			'CREATE TABLE %I (LIKE "click_events" INCLUDING DEFAULTS INCLUDING CONSTRAINTS)',
			part_name
		);
	EXCEPTION WHEN duplicate_table THEN
		RETURN part_name;
	END;

	EXECUTE format(
		'WITH moved AS (
			DELETE FROM "click_events_default"
			WHERE "occurred_at" >= %L AND "occurred_at" < %L
			RETURNING *
		)
		INSERT INTO %I SELECT * FROM moved',
		lo, hi, part_name
	);

	/* Same race, one step later: the winner may have attached between our
	   CREATE and here. Postgres reports an already-attached table as
	   invalid_table_definition rather than a dedicated code. */
	BEGIN
		EXECUTE format(
			'ALTER TABLE "click_events" ATTACH PARTITION %I FOR VALUES FROM (%L) TO (%L)',
			part_name, lo, hi
		);
	EXCEPTION WHEN invalid_table_definition OR invalid_object_definition THEN
		NULL;
	END;

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
CREATE OR REPLACE FUNCTION click_events_drop_partitions_before(cutoff date)
RETURNS integer
LANGUAGE plpgsql
AS $fn$
DECLARE
	dropped integer := 0;
	part record;
BEGIN
	FOR part IN
		SELECT c.relname
		FROM pg_class c
		JOIN pg_inherits i ON i.inhrelid = c.oid
		WHERE i.inhparent = 'public.click_events'::regclass
		  AND c.relname ~ '^click_events_[0-9]{8}$'
	LOOP
		-- Partition covers [day, day + 1), so it is spent once day + 1 has
		-- reached the cutoff.
		IF to_date(right(part.relname, 8), 'YYYYMMDD') + 1 <= cutoff THEN
			EXECUTE format('ALTER TABLE "click_events" DETACH PARTITION %I', part.relname);
			EXECUTE format('DROP TABLE %I', part.relname);
			dropped := dropped + 1;
		END IF;
	END LOOP;
	RETURN dropped;
END;
$fn$;--> statement-breakpoint

/* Provision the days the existing rows need, plus a fortnight ahead so the
   table is usable before the worker has run even once. */
DO $mig$
DECLARE
	d date;
	first_day date;
	last_day date;
BEGIN
	SELECT (min("occurred_at") AT TIME ZONE 'UTC')::date,
	       (max("occurred_at") AT TIME ZONE 'UTC')::date
	INTO first_day, last_day
	FROM "click_events_legacy";

	first_day := least(coalesce(first_day, current_date), current_date);
	last_day  := greatest(coalesce(last_day, current_date), current_date + 14);

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
