import { Body, Controller, Delete, Get, HttpCode, Param, Patch, Post } from "@nestjs/common";
import { ChangeRoleInput, InviteMemberInput } from "@snapurl/contract";
import { zodBody } from "../common/zod.pipe.js";
import { Actor, Roles, type RequestActor } from "../auth/auth.guard.js";
import { MembersService } from "./members.service.js";

@Controller()
export class MembersController {
  constructor(private readonly members: MembersService) {}

  @Get("members")
  list(@Actor() actor: RequestActor) {
    return this.members.list(actor.workspaceId);
  }

  @Post("members")
  @Roles("admin")
  invite(@Actor() actor: RequestActor, @Body(zodBody(InviteMemberInput)) input: InviteMemberInput) {
    return this.members.invite(actor.workspaceId, actor.label, input);
  }

  @Patch("members/:id")
  @Roles("admin")
  @HttpCode(204)
  async changeRole(
    @Actor() actor: RequestActor,
    @Param("id") id: string,
    @Body(zodBody(ChangeRoleInput)) input: ChangeRoleInput,
  ) {
    await this.members.changeRole(actor.workspaceId, id, input.role, actor.label);
  }

  @Delete("members/:id")
  @Roles("admin")
  @HttpCode(204)
  async remove(@Actor() actor: RequestActor, @Param("id") id: string) {
    await this.members.remove(actor.workspaceId, id, actor.label);
  }

  @Get("audit")
  audit(@Actor() actor: RequestActor) {
    return this.members.audit(actor.workspaceId);
  }
}
