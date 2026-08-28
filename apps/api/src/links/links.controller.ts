import { Body, Controller, Delete, Get, Header, HttpCode, Param, Patch, Post, Query, Res } from "@nestjs/common";
import type { FastifyReply } from "fastify";
import { CreateLinkInput, ListLinksQuery, UpdateLinkInput } from "@snapurl/contract";
import { zodBody, zodQuery } from "../common/zod.pipe.js";
import { Actor, Roles, Scope, type RequestActor } from "../auth/auth.guard.js";
import { LinksService } from "./links.service.js";
import { toActor } from "../common/activity.js";

@Controller("links")
export class LinksController {
  constructor(private readonly links: LinksService) {}

  @Get()
  @Scope("links:read")
  list(@Actor() actor: RequestActor, @Query(zodQuery(ListLinksQuery)) query: ListLinksQuery) {
    return this.links.list(actor.workspaceId, query);
  }

  /* Declared before @Get(":id") on purpose.
     Nest matches routes in declaration order, so with :id first the path
     /links/export would be handled as a link whose id is the string "export"
     -- a 404 that looks like a missing link rather than a routing mistake. */
  @Get("export")
  @Scope("links:read")
  @Header("Content-Type", "text/csv; charset=utf-8")
  @Header("Content-Disposition", 'attachment; filename="snapurl-links.csv"')
  async export(
    @Actor() actor: RequestActor,
    @Query(zodQuery(ListLinksQuery)) query: ListLinksQuery,
    @Res() reply: FastifyReply,
  ) {
    reply.raw.writeHead(200, {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": 'attachment; filename="snapurl-links.csv"',
    });
    // Written chunk by chunk so the browser starts receiving before the last
    // page has been read out of Postgres.
    for await (const chunk of this.links.exportCsv(actor.workspaceId, query)) {
      reply.raw.write(chunk);
    }
    reply.raw.end();
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
    return this.links.create(actor.workspaceId, toActor(actor), input);
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
    return this.links.update(actor.workspaceId, id, toActor(actor), input);
  }

  @Delete(":id")
  @Roles("editor")
  @Scope("links:write")
  @HttpCode(204)
  async remove(@Actor() actor: RequestActor, @Param("id") id: string) {
    await this.links.remove(actor.workspaceId, id, toActor(actor));
  }
}
