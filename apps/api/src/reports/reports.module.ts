import { Module } from "@nestjs/common";
import { ReportsService } from "./reports.service.js";

/* The unauth intake route lives on PublicController (mirroring the convention
   that every /public route is declared there), so this module only provides the
   service and exports it for PublicModule to share one instance. FEAT-003 adds
   the operator-side controller here. */
@Module({
  providers: [ReportsService],
  exports: [ReportsService],
})
export class ReportsModule {}
