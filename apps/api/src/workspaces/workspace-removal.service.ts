import { Inject, Injectable, Logger, NotFoundException } from "@nestjs/common";
import { domainProjectionOp, domains, eq, inArray, links, projectionOutbox, sql, workspaces, type Database } from "@snapurl/database";
import { DB } from "../database/database.module.js";
import { LinkCacheBustService } from "../common/link-cache-bust.service.js";
import { ProjectionNudgeService } from "../links/projection-nudge.service.js";

/* ============================================================
   #738 — deleting a workspace.

   links.workspace_id is ON DELETE CASCADE, so a bare `DELETE FROM workspaces`
   removes every link row without the projection-outbox DELETE and the cache
   bust each application delete path performs first. A projected link (ordinary
   or a #650 managed bio link) would keep redirecting from DynamoDB / edge KVS
   until something else removed it.

   There is no workspace-delete endpoint today, so nothing in the app calls
   this yet. It is the one sanctioned way to delete a workspace: whoever adds
   the endpoint must go through here. Migration 0021 adds a DELETE trigger on
   links as the guard underneath, so even a raw cascade enqueues the projection
   DELETEs; this service additionally busts the redirect cache by (host, slug)
   (the trigger cannot when the domain row is deleted in the same statement)
   and enqueues the domain-meta refresh for the workspace's custom domains.
   ============================================================ */

const CHUNK = 1000;
const BUST_CONCURRENCY = 25;

@Injectable()
export class WorkspaceRemovalService {
  private readonly logger = new Logger(WorkspaceRemovalService.name);

  constructor(
    @Inject(DB) private readonly db: Database,
    private readonly cacheBust: LinkCacheBustService,
    private readonly projectionNudge: ProjectionNudgeService,
  ) {}

  /** Deletes a workspace and everything it owns. Every link gets a projection
   *  DELETE (and its domains a meta refresh) in the SAME transaction as the
   *  delete, then the redirect cache is busted after commit. Returns how many
   *  links were removed. */
  async remove(workspaceId: string): Promise<{ linksRemoved: number }> {
    const doomed = await this.db.transaction(async (tx) => {
      /* Lock the workspace row first: creating a link takes a FOR KEY SHARE on
         it through the FK, so no link can appear between the read below and
         the delete. */
      const [ws] = await tx.select({ id: workspaces.id }).from(workspaces).where(eq(workspaces.id, workspaceId)).for("update");
      if (!ws) throw new NotFoundException("Workspace not found.");

      const rows = await tx
        .select({ id: links.id, slug: links.slug, domain: domains.domain })
        .from(links)
        .innerJoin(domains, eq(links.domainId, domains.id))
        .where(eq(links.workspaceId, workspaceId));
      const ownDomains = await tx
        .select({ id: domains.id, domain: domains.domain })
        .from(domains)
        .where(eq(domains.workspaceId, workspaceId));

      for (let i = 0; i < rows.length; i += CHUNK) {
        const ids = rows.slice(i, i + CHUNK).map((r) => r.id);
        /* Same lock order as LinksService.remove: click_events before links,
           so a delete landing mid-rollup waits instead of deadlocking. */
        await tx.execute(sql`
          select count(*) from (select 1 from click_events where link_id in (${sql.join(ids.map((i) => sql`${i}`), sql`, `)}) for update) locked
        `);
        await tx.insert(projectionOutbox).values(
          ids.map((linkId) => ({ linkId, operation: "delete", payload: { linkId, operation: "delete" } })),
        );
      }
      for (const d of ownDomains) await tx.insert(projectionOutbox).values(domainProjectionOp(d.id, d.domain));

      // Links first (managed bio links included), then the workspace, which
      // cascades the rest. The links are already gone, so nothing is skipped.
      for (let i = 0; i < rows.length; i += CHUNK) {
        await tx.delete(links).where(inArray(links.id, rows.slice(i, i + CHUNK).map((r) => r.id)));
      }
      await tx.delete(workspaces).where(eq(workspaces.id, workspaceId));
      return rows;
    });

    this.projectionNudge.nudge();
    for (let i = 0; i < doomed.length; i += BUST_CONCURRENCY) {
      await Promise.all(doomed.slice(i, i + BUST_CONCURRENCY).map((r) => this.cacheBust.bust(r.domain, r.slug)));
    }
    this.logger.log({ workspaceId, links: doomed.length }, "workspace removed");
    return { linksRemoved: doomed.length };
  }
}
