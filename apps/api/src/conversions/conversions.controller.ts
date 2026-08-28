import { Body, Controller, Get, HttpCode, Post, Query } from "@nestjs/common";
import { RecordConversionInput } from "@snapurl/contract";
import { zodBody } from "../common/zod.pipe.js";
import { Actor, Scope, type RequestActor } from "../auth/auth.guard.js";
import { ConversionsService } from "./conversions.service.js";
import { toActor } from "../common/activity.js";

@Controller("conversions")
export class ConversionsController {
  constructor(private readonly conversions: ConversionsService) {}

  @Get()
  @Scope("analytics:read")
  report(@Actor() actor: RequestActor, @Query("range") range?: string) {
    return this.conversions.report(actor.workspaceId, range ?? "30d");
  }

  /** How a customer's site reports a conversion back. Usually called with an
   *  API key rather than a session, which is why it carries its own scope. */
  @Post()
  @Scope("conversions:write")
  @HttpCode(201)
  record(@Actor() actor: RequestActor, @Body(zodBody(RecordConversionInput)) input: RecordConversionInput) {
    return this.conversions.record(actor.workspaceId, toActor(actor), input);
  }
}
