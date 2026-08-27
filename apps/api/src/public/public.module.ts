import { Module } from "@nestjs/common";
import { PublicController } from "./public.controller.js";
import { PublicService } from "./public.service.js";

@Module({ controllers: [PublicController], providers: [PublicService] })
export class PublicModule {}
