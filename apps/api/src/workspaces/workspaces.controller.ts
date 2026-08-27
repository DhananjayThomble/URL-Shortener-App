import { Body, Controller, Get, Patch } from "@nestjs/common";
import { UpdateWorkspaceInput } from "@snapurl/contract";
import { zodBody } from "../common/zod.pipe.js";
import { Actor, Roles, type RequestActor } from "../auth/auth.guard.js";
import { WorkspacesService } from "./workspaces.service.js";

@Controller("workspaces")
export class WorkspacesController {
  constructor(private readonly workspaces: WorkspacesService) {}

  @Get("current")
  current(@Actor() actor: RequestActor) {
    return this.workspaces.current(actor.workspaceId);
  }

  @Patch("current")
  @Roles("admin")
  update(@Actor() actor: RequestActor, @Body(zodBody(UpdateWorkspaceInput)) input: UpdateWorkspaceInput) {
    return this.workspaces.update(actor.workspaceId, input);
  }
}
