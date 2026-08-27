import { Module } from "@nestjs/common";
import { DomainsController } from "./domains.controller.js";
import { DomainsService } from "./domains.service.js";

@Module({ controllers: [DomainsController], providers: [DomainsService], exports: [DomainsService] })
export class DomainsModule {}
