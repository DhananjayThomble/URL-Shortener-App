ALTER TABLE "links" ADD COLUMN "managed_bio_page_id" uuid;--> statement-breakpoint
CREATE INDEX "links_managed_bio_page_idx" ON "links" USING btree ("managed_bio_page_id") WHERE "links"."managed_bio_page_id" is not null;--> statement-breakpoint
-- #650: a managed link belongs to the bio page it serves. Deleting the bio
-- page removes the link too (the unpublish/delete path still goes through
-- LinksService.remove so the cache-bust fires, but the CASCADE is the backstop
-- for a raw bio_pages delete). Declared here rather than with drizzle's
-- `.references()` to avoid the links <-> bio_pages import cycle (bio_pages is
-- defined in developers.ts, which imports links).
ALTER TABLE "links"
  ADD CONSTRAINT "links_managed_bio_page_id_bio_pages_id_fk"
  FOREIGN KEY ("managed_bio_page_id") REFERENCES "bio_pages"("id") ON DELETE cascade;