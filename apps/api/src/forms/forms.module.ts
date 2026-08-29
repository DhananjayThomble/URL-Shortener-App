import { Module } from "@nestjs/common";
import { FormsController } from "./forms.controller.js";
import { FormsService } from "./forms.service.js";

@Module({
  controllers: [FormsController],
  providers: [FormsService],
  exports: [FormsService],
})
export class FormsModule {}
