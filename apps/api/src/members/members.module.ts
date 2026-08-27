import { Module } from "@nestjs/common";
import { MembersController } from "./members.controller.js";
import { MembersService } from "./members.service.js";

@Module({ controllers: [MembersController], providers: [MembersService], exports: [MembersService] })
export class MembersModule {}
