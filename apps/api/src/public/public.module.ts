import { Module } from "@nestjs/common";
import { PublicController } from "./public.controller.js";
import { PublicService } from "./public.service.js";
import { FormsModule } from "../forms/forms.module.js";
import { ReportsModule } from "../reports/reports.module.js";

/* FormsModule and ReportsModule are imported rather than their services
   re-provided, so the public routes and the dashboard's share one instance and
   one set of rules. */
@Module({
  imports: [FormsModule, ReportsModule],
  controllers: [PublicController],
  providers: [PublicService],
})
export class PublicModule {}
