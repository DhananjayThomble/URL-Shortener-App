import { Body, Controller, Delete, Get, HttpCode, Param, ParseUUIDPipe, Put } from "@nestjs/common";
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

  /* :id parsed as a UUID at the edge, same as LinksController — a malformed
     id is a client mistake, not a lookup that happens to miss. Without this,
     Postgres raises `invalid input syntax for type uuid` (22P02), which
     PostgresErrorFilter does not map, surfacing as a 500 (issue #533). */
  @Delete(":id")
  @Roles("editor")
  @HttpCode(204)
  async remove(@Actor() actor: RequestActor, @Param("id", ParseUUIDPipe) id: string) {
    await this.bio.remove(actor.workspaceId, id);
  }
}
