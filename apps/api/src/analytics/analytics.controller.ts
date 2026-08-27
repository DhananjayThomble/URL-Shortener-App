import { Controller, Get, Query } from "@nestjs/common";
import { AnalyticsQuery } from "@snapurl/contract";
import { zodQuery } from "../common/zod.pipe.js";
import { Actor, Scope, type RequestActor } from "../auth/auth.guard.js";
import { AnalyticsService } from "./analytics.service.js";

@Controller("analytics")
export class AnalyticsController {
  constructor(private readonly analytics: AnalyticsService) {}

  @Get()
  @Scope("analytics:read")
  overview(@Actor() actor: RequestActor, @Query(zodQuery(AnalyticsQuery)) query: AnalyticsQuery) {
    return this.analytics.overview(actor.workspaceId, query);
  }
}
