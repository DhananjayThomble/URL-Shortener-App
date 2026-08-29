import { Body, Controller, Delete, Get, HttpCode, Param, Post, Patch, Res } from "@nestjs/common";
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

  @Get(":id")
  @Scope("links:read")
  get(@Actor() actor: RequestActor, @Param("id") id: string) {
    return this.forms.get(actor.workspaceId, id);
  }

  @Get(":id/responses")
  @Scope("links:read")
  responses(@Actor() actor: RequestActor, @Param("id") id: string) {
    return this.forms.responses(actor.workspaceId, id);
  }

  /* Streamed like the links export, so a form with 50,000 responses does not
     have to fit in memory before the first byte reaches the browser. */
  @Get(":id/responses.csv")
  @Scope("links:read")
  async exportResponses(@Actor() actor: RequestActor, @Param("id") id: string, @Res() reply: FastifyReply) {
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
    @Param("id") id: string,
    @Body(zodBody(UpdateFormInput)) input: UpdateFormInput,
  ) {
    return this.forms.update(actor.workspaceId, id, toActor(actor), input);
  }

  @Delete(":id")
  @Roles("editor")
  @Scope("links:write")
  @HttpCode(204)
  async remove(@Actor() actor: RequestActor, @Param("id") id: string) {
    await this.forms.remove(actor.workspaceId, id, toActor(actor));
  }
}
