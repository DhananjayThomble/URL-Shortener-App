import { Module } from "@nestjs/common";
import { DevelopersController } from "./developers.controller.js";
import { DevelopersService } from "./developers.service.js";

@Module({ controllers: [DevelopersController], providers: [DevelopersService], exports: [DevelopersService] })
export class DevelopersModule {}
