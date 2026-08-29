/* ============================================================
   Click counters move off `links` into their own table.

   Why: `links` is the row the redirect hot path resolves against
   (PostgresLinkResolver, and any future cached adapter). The rollup
   worker rewrote clicks/unique_clicks on it every minute, taking row
   locks and churning indexes on the read path — contention where it
   is least affordable, at high write rates, once a minute.

   link_counters carries the same two counters keyed by link_id, so
   the rollup writes a table nothing latency-sensitive reads. The
   click-limit gate still reads the counter, so it is keyed by link_id
   for a cheap single-key lookup. This does not change the documented
   "click limits may overshoot slightly" behaviour: the counter is
   still the last rollup's value, not a live one — only the table it
   lives in changed.

   The backfill keeps any populated dev/fixture database consistent
   across the column move; it runs while `links` still carries the
   columns, before they are dropped. The constraint/PK names below are
   drizzle's own, so a future `drizzle-kit generate` sees no drift.
   ============================================================ */

CREATE TABLE "link_counters" (
	"link_id" uuid PRIMARY KEY NOT NULL,
	"clicks" integer DEFAULT 0 NOT NULL,
	"unique_clicks" integer DEFAULT 0 NOT NULL
);
--> statement-breakpoint
INSERT INTO "link_counters" ("link_id", "clicks", "unique_clicks") SELECT "id", "clicks", "unique_clicks" FROM "links";--> statement-breakpoint
ALTER TABLE "link_counters" ADD CONSTRAINT "link_counters_link_id_links_id_fk" FOREIGN KEY ("link_id") REFERENCES "public"."links"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "links" DROP COLUMN "clicks";--> statement-breakpoint
ALTER TABLE "links" DROP COLUMN "unique_clicks";
