import { Body, Controller, Delete, Get, HttpCode, Param, Put } from "@nestjs/common";
import { UpsertBioPageInput } from "@snapurl/contract";
import { zodBody } from "../common/zod.pipe.js";
import { Actor, Roles, type RequestActor } from "../auth/auth.guard.js";
import { BioPagesService } from "./bio-pages.service.js";

@Controller("bio-pages")
export class BioPagesController {
  constructor(private readonly bio: BioPagesService) {}

  @Get()
  list(@Actor() actor: RequestActor) {
    return this.bio.list(actor.workspaceId);
  }

  @Put()
  @Roles("editor")
  upsert(@Actor() actor: RequestActor, @Body(zodBody(UpsertBioPageInput)) input: UpsertBioPageInput) {
    return this.bio.upsert(actor.workspaceId, input);
  }

  @Delete(":id")
  @Roles("editor")
  @HttpCode(204)
  async remove(@Actor() actor: RequestActor, @Param("id") id: string) {
    await this.bio.remove(actor.workspaceId, id);
  }
}
