import { Module } from "@nestjs/common";
import { LinksController } from "./links.controller.js";
import { LinksService } from "./links.service.js";
import { ProjectionNudgeService } from "./projection-nudge.service.js";
import { SafeBrowsingModule } from "../safe-browsing/safe-browsing.module.js";

@Module({
  imports: [SafeBrowsingModule],
  controllers: [LinksController],
  providers: [LinksService, ProjectionNudgeService],
  exports: [LinksService],
})
export class LinksModule {}
