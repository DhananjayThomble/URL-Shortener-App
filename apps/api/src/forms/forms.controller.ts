import { Body, Controller, Delete, Get, HttpCode, Param, ParseUUIDPipe, Post, Patch, Res } from "@nestjs/common";
import type { FastifyReply } from "fastify";
import { CreateFormInput, UpdateFormInput } from "@snapurl/contract";
import { zodBody } from "../common/zod.pipe.js";
import { Actor, Roles, Scope, type RequestActor } from "../auth/auth.guard.js";
import { FormsService } from "./forms.service.js";
import { toActor } from "../common/activity.js";

@Controller("forms")
export class FormsController {
  constructor(private readonly forms: FormsService) {}

  @Get()
  @Scope("links:read")
  list(@Actor() actor: RequestActor) {
    return this.forms.list(actor.workspaceId);
  }

  /* :id is parsed as a UUID at the edge on every route below, same as
     LinksController. Form ids are uuidv7 columns, so a malformed id (e.g.
     "not-a-uuid") is a client mistake, not a lookup that happens to miss.
     ParseUUIDPipe turns it into a clean 400 BEFORE the value reaches a
     Drizzle `where id = $1` query, where Postgres would otherwise raise
     `invalid input syntax for type uuid` (22P02) — a code PostgresErrorFilter
     does not map, so it surfaced as a 500 (issue #533). */
  @Get(":id")
  @Scope("links:read")
  get(@Actor() actor: RequestActor, @Param("id", ParseUUIDPipe) id: string) {
    return this.forms.get(actor.workspaceId, id);
  }

  @Get(":id/responses")
  @Scope("links:read")
  responses(@Actor() actor: RequestActor, @Param("id", ParseUUIDPipe) id: string) {
    return this.forms.responses(actor.workspaceId, id);
  }

  /* Streamed like the links export, so a form with 50,000 responses does not
     have to fit in memory before the first byte reaches the browser.

     The workspace-scoped lookup happens here, BEFORE writeHead, rather than
     relying on exportCsv()'s own `this.get(...)` at the top of its body.
     exportCsv is an async generator: its body does not run at all until the
     first `next()`, which the `for await` below only issues *after* the head
     has already gone out. A not-readable id would otherwise throw once the
     response is already committed, leaving the exception filter unable to
     send a normal 404 (see PostgresErrorFilter). Resolving it out here means
     the throw happens while the response is still uncommitted. */
  @Get(":id/responses.csv")
  @Scope("links:read")
  async exportResponses(
    @Actor() actor: RequestActor,
    @Param("id", ParseUUIDPipe) id: string,
    @Res() reply: FastifyReply,
  ) {
    await this.forms.get(actor.workspaceId, id);
    reply.raw.writeHead(200, {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": 'attachment; filename="snapurl-responses.csv"',
    });
    for await (const chunk of this.forms.exportCsv(actor.workspaceId, id)) reply.raw.write(chunk);
    reply.raw.end();
  }

  @Post()
  @Roles("editor")
  @Scope("links:write")
  create(@Actor() actor: RequestActor, @Body(zodBody(CreateFormInput)) input: CreateFormInput) {
    return this.forms.create(actor.workspaceId, toActor(actor), input);
  }

  @Patch(":id")
  @Roles("editor")
  @Scope("links:write")
  update(
    @Actor() actor: RequestActor,
    @Param("id", ParseUUIDPipe) id: string,
    @Body(zodBody(UpdateFormInput)) input: UpdateFormInput,
  ) {
    return this.forms.update(actor.workspaceId, id, toActor(actor), input);
  }

  @Delete(":id")
  @Roles("editor")
  @Scope("links:write")
  @HttpCode(204)
  async remove(@Actor() actor: RequestActor, @Param("id", ParseUUIDPipe) id: string) {
    await this.forms.remove(actor.workspaceId, id, toActor(actor));
  }
}
