import { Body, Controller, Delete, Get, HttpCode, Param, Patch, Post, Query } from "@nestjs/common";
import { CreateLinkInput, ListLinksQuery, UpdateLinkInput } from "@snapurl/contract";
import { zodBody, zodQuery } from "../common/zod.pipe.js";
import { Actor, Roles, Scope, type RequestActor } from "../auth/auth.guard.js";
import { LinksService } from "./links.service.js";

@Controller("links")
export class LinksController {
  constructor(private readonly links: LinksService) {}

  @Get()
  @Scope("links:read")
  list(@Actor() actor: RequestActor, @Query(zodQuery(ListLinksQuery)) query: ListLinksQuery) {
    return this.links.list(actor.workspaceId, query);
  }

  @Get(":id")
  @Scope("links:read")
  get(@Actor() actor: RequestActor, @Param("id") id: string) {
    return this.links.get(actor.workspaceId, id);
  }

  @Post()
  @Roles("editor")
  @Scope("links:write")
  create(@Actor() actor: RequestActor, @Body(zodBody(CreateLinkInput)) input: CreateLinkInput) {
    return this.links.create(actor.workspaceId, actor.userId, input);
  }

  /* G1 — the endpoint the frontend needed and the contract didn't have. */
  @Patch(":id")
  @Roles("editor")
  @Scope("links:write")
  update(
    @Actor() actor: RequestActor,
    @Param("id") id: string,
    @Body(zodBody(UpdateLinkInput)) input: UpdateLinkInput,
  ) {
    return this.links.update(actor.workspaceId, id, input);
  }

  @Delete(":id")
  @Roles("editor")
  @Scope("links:write")
  @HttpCode(204)
  async remove(@Actor() actor: RequestActor, @Param("id") id: string) {
    await this.links.remove(actor.workspaceId, id);
  }
}
