ALTER TABLE "links" ADD COLUMN "managed_bio_page_id" uuid;--> statement-breakpoint
-- Partial index on a column that is NULL for every existing row and for every
-- ordinary link forever, so the build scans nothing and takes only a brief
-- lock — CREATE INDEX CONCURRENTLY is unnecessary here (and cannot run inside
-- the transaction drizzle's migrator wraps each file in; the repo has no
-- concurrent-index precedent). It supports both the bio-publish lookup and the
-- `managed_bio_page_id IS NULL` filter the links list applies.
CREATE INDEX "links_managed_bio_page_idx" ON "links" USING btree ("managed_bio_page_id") WHERE "links"."managed_bio_page_id" is not null;--> statement-breakpoint
-- #650: a managed link belongs to the bio page it serves.
--
-- ON DELETE **NO ACTION** (not CASCADE): a raw `DELETE FROM bio_pages` while a
-- managed link still points at the page is REFUSED, which forces page deletion
-- through BioPagesService.remove — the only path that enqueues the projection
-- DELETE and busts the redirect cache before the link row goes. CASCADE would
-- silently drop a projected link, leaving a stale Dynamo/KVS key and a stale
-- hot-cache entry with nothing to notice (#734 review, Blocker 2).
--
-- NO ACTION is checked at end-of-statement, so a workspace deletion still works:
-- `DELETE FROM workspaces` cascades to BOTH links (via links.workspace_id) and
-- bio_pages (via bio_pages.workspace_id) in the same statement, so the managed
-- link is already gone when the check runs. On that path managed links are no
-- worse than ordinary links, which are themselves cascade-deleted by
-- links.workspace_id without an app-level outbox enqueue — a pre-existing
-- property of workspace deletion, not introduced here (there is no workspace
-- delete endpoint today).
--
-- Added NOT VALID then VALIDATE: NOT VALID skips the full-table validation scan
-- at add time (every existing row is NULL, so there is nothing to validate),
-- taking only a brief lock; VALIDATE then confirms the (empty) obligation.
-- Declared here rather than with drizzle's `.references()` to avoid the
-- links <-> bio_pages import cycle (bio_pages is defined in developers.ts,
-- which imports links).
ALTER TABLE "links"
  ADD CONSTRAINT "links_managed_bio_page_id_bio_pages_id_fk"
  FOREIGN KEY ("managed_bio_page_id") REFERENCES "bio_pages"("id") ON DELETE no action NOT VALID;--> statement-breakpoint
ALTER TABLE "links" VALIDATE CONSTRAINT "links_managed_bio_page_id_bio_pages_id_fk";
