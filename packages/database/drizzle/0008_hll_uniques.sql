/* ============================================================
   Uniques stop being exact rows and become a HyperLogLog sketch.

   Why: daily_visitors stored one row per (link_id, day,
   visitor_hash). At 1,000 clicks/second with half the traffic
   unique that is ~43M rows a day, and 45 days of retention put
   ~2 billion rows in a btree. That is a hard scale ceiling, not a
   tuning problem, and no index budget makes a COUNT(DISTINCT) over
   it cheap.

   The fix is a fixed-size (~16 KiB) HLL sketch per (link_id, day)
   in a bytea column, merged register-wise during rollup. The sketch
   is implemented in @snapurl/domain in pure TypeScript rather than
   via the postgresql-hll extension on purpose: an extension adds a
   dependency to the "docker compose up" promise the single-node
   profile is built on, and it does not port to ClickHouse or Redis,
   so a sketch we own is the only one that works on vanilla Postgres,
   any managed Postgres and behind any future analytics adapter
   unchanged.

   click_daily_uniques is a separate companion table, not a column on
   click_daily, so click_daily stays a thin all-integer counter row
   the dashboard sums cheaply; a 16 KiB blob on every one of those
   rows would bloat every dashboard scan. It also preserves the
   separation daily_visitors gave us: the sketch is the durable
   uniques record independent of the raw click_events, so retention
   can drop raw events while uniques stay correct.

   This is a pre-deployment schema change, not a backfill: nothing is
   in production, so daily_visitors is simply dropped rather than
   converted. The constraint names below are drizzle's own, so a
   future `drizzle-kit generate` sees no drift.
   ============================================================ */

CREATE TABLE "click_daily_uniques" (
	"link_id" uuid NOT NULL,
	"day" date NOT NULL,
	"sketch" "bytea" NOT NULL,
	CONSTRAINT "click_daily_uniques_link_id_day_pk" PRIMARY KEY("link_id","day")
);
--> statement-breakpoint
DROP TABLE "daily_visitors" CASCADE;--> statement-breakpoint
ALTER TABLE "click_daily_uniques" ADD CONSTRAINT "click_daily_uniques_link_id_links_id_fk" FOREIGN KEY ("link_id") REFERENCES "public"."links"("id") ON DELETE cascade ON UPDATE no action;
