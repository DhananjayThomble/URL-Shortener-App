import { Body, Controller, Delete, Get, HttpCode, Param, Patch, Post } from "@nestjs/common";
import { AddDomainInput, UpdateDomainInput } from "@snapurl/contract";
import { zodBody } from "../common/zod.pipe.js";
import { Actor, Roles, Scope, type RequestActor } from "../auth/auth.guard.js";
import { DomainsService } from "./domains.service.js";
import { toActor } from "../common/activity.js";

@Controller("domains")
export class DomainsController {
  constructor(private readonly domains: DomainsService) {}

  @Get()
  @Scope("domains:read")
  list(@Actor() actor: RequestActor) {
    return this.domains.list(actor.workspaceId);
  }

  @Post()
  @Roles("admin")
  @Scope("domains:write")
  add(@Actor() actor: RequestActor, @Body(zodBody(AddDomainInput)) input: AddDomainInput) {
    return this.domains.add(actor.workspaceId, input);
  }

  @Post(":id/verify")
  @Roles("admin")
  @Scope("domains:write")
  @HttpCode(200)
  verify(@Actor() actor: RequestActor, @Param("id") id: string) {
    return this.domains.verify(actor.workspaceId, id, toActor(actor));
  }

  /* #648: set / change / clear root and 404 redirects after creation.
     Same role + scope gate as every other domain mutation. */
  @Patch(":id")
  @Roles("admin")
  @Scope("domains:write")
  update(
    @Actor() actor: RequestActor,
    @Param("id") id: string,
    @Body(zodBody(UpdateDomainInput)) input: UpdateDomainInput,
  ) {
    return this.domains.update(actor.workspaceId, id, input, toActor(actor));
  }

  @Delete(":id")
  @Roles("admin")
  @Scope("domains:write")
  @HttpCode(204)
  async remove(@Actor() actor: RequestActor, @Param("id") id: string) {
    await this.domains.remove(actor.workspaceId, id);
  }
}
