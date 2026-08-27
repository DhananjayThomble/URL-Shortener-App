import { Module } from "@nestjs/common";
import { ConversionsController } from "./conversions.controller.js";
import { ConversionsService } from "./conversions.service.js";

@Module({ controllers: [ConversionsController], providers: [ConversionsService], exports: [ConversionsService] })
export class ConversionsModule {}
