import { Global, Module } from "@nestjs/common";
import { LinkCacheBustService } from "./link-cache-bust.service.js";
import { ProjectionNudgeService } from "../links/projection-nudge.service.js";

/** Global so LinksService and ReportsService can both inject
 *  LinkCacheBustService and ProjectionNudgeService without either module
 *  importing the other — mirroring DatabaseModule's @Global() pattern for
 *  DB/READ_DB. Every projectionOutbox writer needs both: the bust drops the
 *  redirect's hot-cache entry, and the nudge gets the new state into the
 *  projection the redirect then re-reads. Either alone leaves it stale. */
@Global()
@Module({
  providers: [LinkCacheBustService, ProjectionNudgeService],
  exports: [LinkCacheBustService, ProjectionNudgeService],
})
export class CommonModule {}
