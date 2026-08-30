import { Module } from "@nestjs/common";
import { ReportsController } from "./reports.controller.js";
import { ReportsService } from "./reports.service.js";

/* The unauth intake route lives on PublicController (mirroring the convention
   that every /public route is declared there), so this module provides the
   service and exports it for PublicModule to share one instance. The
   operator-side authed surface (FEAT-003) is declared by ReportsController; it
   flags links via a direct scoped db.update, so no LinksModule import is needed. */
@Module({
  controllers: [ReportsController],
  providers: [ReportsService],
  exports: [ReportsService],
})
export class ReportsModule {}
