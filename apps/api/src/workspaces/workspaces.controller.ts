import { Body, Controller, Get, Patch } from "@nestjs/common";
import { UpdateWorkspaceInput, type WorkspaceUsage } from "@snapurl/contract";
import { zodBody } from "../common/zod.pipe.js";
import { Actor, Roles, type RequestActor } from "../auth/auth.guard.js";
import { WorkspacesService } from "./workspaces.service.js";
import { UsageService } from "../plans/usage.service.js";

@Controller("workspaces")
export class WorkspacesController {
  constructor(
    private readonly workspaces: WorkspacesService,
    private readonly usage: UsageService,
  ) {}

  @Get("current")
  current(@Actor() actor: RequestActor) {
    return this.workspaces.current(actor.workspaceId);
  }

  /* #970 — this workspace's usage against its plan limits, for the Settings
     screen: a row per limit with used / limit / percent, plus any active
     80%/100% warnings (the in-app banner). Any member may read it. */
  @Get("current/usage")
  usageForCurrent(@Actor() actor: RequestActor): Promise<WorkspaceUsage> {
    return this.usage.usageFor(actor.workspaceId);
  }

  @Patch("current")
  @Roles("admin")
  update(@Actor() actor: RequestActor, @Body(zodBody(UpdateWorkspaceInput)) input: UpdateWorkspaceInput) {
    return this.workspaces.update(actor.workspaceId, input);
  }
}
