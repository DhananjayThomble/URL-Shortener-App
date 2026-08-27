import { Module } from "@nestjs/common";
import { BioPagesController } from "./bio-pages.controller.js";
import { BioPagesService } from "./bio-pages.service.js";

@Module({ controllers: [BioPagesController], providers: [BioPagesService], exports: [BioPagesService] })
export class BioPagesModule {}
