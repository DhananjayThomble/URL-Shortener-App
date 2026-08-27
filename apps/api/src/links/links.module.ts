import { Module } from "@nestjs/common";
import { LinksController } from "./links.controller.js";
import { LinksService } from "./links.service.js";
import { SafeBrowsingModule } from "../safe-browsing/safe-browsing.module.js";

@Module({
  imports: [SafeBrowsingModule],
  controllers: [LinksController],
  providers: [LinksService],
  exports: [LinksService],
})
export class LinksModule {}
