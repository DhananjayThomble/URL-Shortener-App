import { Body, Controller, Delete, Get, Header, HttpCode, Param, ParseUUIDPipe, Patch, Post, Query, Res } from "@nestjs/common";
import type { FastifyReply } from "fastify";
import { BulkCreateLinksInput, CloneLinkInput, CreateLinkInput, ListLinksQuery, UpdateLinkInput } from "@snapurl/contract";
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

  /* Every :id route below parses the param as a UUID at the edge. Link ids are
     uuidv7 columns, so an empty ("/links//clone") or malformed id is a client
     mistake, not a lookup that happens to miss. ParseUUIDPipe turns it into a
     clean 400 BEFORE the value reaches a Drizzle `where id = $1` query — where
     Postgres would otherwise raise `invalid input syntax for type uuid: ""`
     (22P02), which the PostgresErrorFilter cannot map and surfaces as a 500. */
  @Get(":id")
  @Scope("links:read")
  get(@Actor() actor: RequestActor, @Param("id", ParseUUIDPipe) id: string) {
    return this.links.get(actor.workspaceId, id);
  }

  @Post()
  @Roles("editor")
  @Scope("links:write")
  create(@Actor() actor: RequestActor, @Body(zodBody(CreateLinkInput)) input: CreateLinkInput) {
    return this.links.create(actor.workspaceId, toActor(actor), input);
  }

  /* Always 200, never 207.
     Either every row was written or none was, so there is no "multi-status" to
     report — the per-row detail is in the body, where a caller can act on it,
     rather than in a status code they would have to special-case. */
  @Post("bulk")
  @Roles("editor")
  @Scope("links:write")
  @HttpCode(200)
  bulkCreate(@Actor() actor: RequestActor, @Body(zodBody(BulkCreateLinksInput)) input: BulkCreateLinksInput) {
    return this.links.bulkCreate(actor.workspaceId, toActor(actor), input);
  }

  /* A creation, not a mutation of :id — the source link is untouched, so this
     is POST to a subresource rather than PATCH. Returns the new link. */
  @Post(":id/clone")
  @Roles("editor")
  @Scope("links:write")
  clone(
    @Actor() actor: RequestActor,
    @Param("id", ParseUUIDPipe) id: string,
    @Body(zodBody(CloneLinkInput)) input: CloneLinkInput,
  ) {
    return this.links.clone(actor.workspaceId, id, toActor(actor), input);
  }

  /* G1 — the endpoint the frontend needed and the contract didn't have. */
  @Patch(":id")
  @Roles("editor")
  @Scope("links:write")
  update(
    @Actor() actor: RequestActor,
    @Param("id", ParseUUIDPipe) id: string,
    @Body(zodBody(UpdateLinkInput)) input: UpdateLinkInput,
  ) {
    return this.links.update(actor.workspaceId, id, toActor(actor), input);
  }

  @Delete(":id")
  @Roles("editor")
  @Scope("links:write")
  @HttpCode(204)
  async remove(@Actor() actor: RequestActor, @Param("id", ParseUUIDPipe) id: string) {
    await this.links.remove(actor.workspaceId, id, toActor(actor));
  }
}
