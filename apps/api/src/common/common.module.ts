import { Global, Module } from "@nestjs/common";
import { LinkCacheBustService } from "./link-cache-bust.service.js";

/** Global so LinksService and ReportsService can both inject
 *  LinkCacheBustService without either module importing the other —
 *  mirroring DatabaseModule's @Global() pattern for DB/READ_DB. */
@Global()
@Module({
  providers: [LinkCacheBustService],
  exports: [LinkCacheBustService],
})
export class CommonModule {}
