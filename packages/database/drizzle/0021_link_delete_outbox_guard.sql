-- #738: deleting a workspace cascades (links.workspace_id ON DELETE CASCADE) to
-- its links WITHOUT the projection-outbox DELETE and cache bust every
-- application delete path performs first. A projected link, ordinary or a #650
-- managed bio link, would then keep redirecting from DynamoDB / edge KVS until
-- something else removed it.
--
-- The application path (WorkspacesService.remove) enqueues the DELETEs itself.
-- This trigger is the guard underneath it, so a raw cascade (or any other raw
-- `DELETE FROM links`) cannot skip the invalidation:
--
--   * it enqueues a `delete` projection_outbox row for every deleted link that
--     has no pending `delete` row of its own. Every application delete path
--     inserts its outbox row BEFORE deleting the link, in the same transaction,
--     so those paths see the row here and add nothing (no duplicate work);
--   * it broadcasts link_cache_bust (the same channel and payload
--     LinkCacheBustService uses) so the redirect's hot cache drops the entry
--     when the transaction commits. pg_notify is transactional, so nothing is
--     sent for a rolled-back delete. When the link's domain row is already gone
--     in the same statement (a workspace cascade removes domains too) the
--     host is unknown and the notify is skipped; the projection DELETE is
--     keyed by link id and still lands, and LINK_CACHE_TTL_SECONDS bounds the
--     hot-cache fallback.
--
-- A trigger rather than ON DELETE NO ACTION on links.workspace_id: NO ACTION
-- would also refuse every existing raw `DELETE FROM workspaces` used for test
-- cleanup, whereas this makes the raw cascade SAFE instead of forbidden.
CREATE OR REPLACE FUNCTION "links_enqueue_projection_delete"() RETURNS trigger AS $$
DECLARE
  host text;
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM "projection_outbox"
    WHERE "link_id" = OLD."id" AND "operation" = 'delete' AND "processed_at" IS NULL
  ) THEN
    INSERT INTO "projection_outbox" ("link_id", "operation", "payload")
    VALUES (OLD."id", 'delete', jsonb_build_object('linkId', OLD."id", 'operation', 'delete'));
  END IF;

  SELECT "domain" INTO host FROM "domains" WHERE "id" = OLD."domain_id";
  IF host IS NOT NULL THEN
    PERFORM pg_notify('link_cache_bust', json_build_object('host', host, 'slug', OLD."slug")::text);
  END IF;
  RETURN OLD;
END;
$$ LANGUAGE plpgsql;--> statement-breakpoint
CREATE TRIGGER "links_enqueue_projection_delete"
  AFTER DELETE ON "links"
  FOR EACH ROW EXECUTE FUNCTION "links_enqueue_projection_delete"();
