import { Body, Controller, Get, Param, Patch } from "@nestjs/common";
import { UpdateAbuseReportInput } from "@snapurl/contract";
import { zodBody } from "../common/zod.pipe.js";
import { Actor, Roles, Scope, type RequestActor } from "../auth/auth.guard.js";
import { toActor } from "../common/activity.js";
import { ReportsService } from "./reports.service.js";

/* ============================================================
   Operator-side abuse-report review — #291 (FEAT-003).

   These routes are AUTHENTICATED and workspace-scoped: an operator sees and
   acts on reports whose slug resolved to a link in their own workspace. The
   unauthenticated intake route (@Public) deliberately lives on
   PublicController, matching the repo convention that every /public route is
   declared there; this controller carries only the authed surface.
   ============================================================ */
@Controller("reports")
export class ReportsController {
  constructor(private readonly reports: ReportsService) {}

  @Get()
  @Scope("links:read")
  list(@Actor() actor: RequestActor) {
    return this.reports.list(actor.workspaceId);
  }

  @Patch(":id")
  @Roles("editor")
  @Scope("links:write")
  update(
    @Actor() actor: RequestActor,
    @Param("id") id: string,
    @Body(zodBody(UpdateAbuseReportInput)) input: UpdateAbuseReportInput,
  ) {
    return this.reports.review(actor.workspaceId, id, toActor(actor), input);
  }
}
