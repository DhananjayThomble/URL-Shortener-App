import { Body, Controller, Delete, Get, HttpCode, Param, Post } from "@nestjs/common";
import { CreateApiKeyInput, CreateWebhookInput } from "@snapurl/contract";
import { zodBody } from "../common/zod.pipe.js";
import { Actor, Roles, type RequestActor } from "../auth/auth.guard.js";
import { DevelopersService } from "./developers.service.js";

@Controller()
export class DevelopersController {
  constructor(private readonly developers: DevelopersService) {}

  @Get("api-keys")
  @Roles("admin")
  listKeys(@Actor() actor: RequestActor) {
    return this.developers.listKeys(actor.workspaceId);
  }

  @Post("api-keys")
  @Roles("admin")
  createKey(@Actor() actor: RequestActor, @Body(zodBody(CreateApiKeyInput)) input: CreateApiKeyInput) {
    return this.developers.createKey(actor.workspaceId, actor.userId, input);
  }

  @Delete("api-keys/:id")
  @Roles("admin")
  @HttpCode(204)
  async revokeKey(@Actor() actor: RequestActor, @Param("id") id: string) {
    await this.developers.revokeKey(actor.workspaceId, id);
  }

  @Get("webhooks")
  @Roles("admin")
  listWebhooks(@Actor() actor: RequestActor) {
    return this.developers.listWebhooks(actor.workspaceId);
  }

  @Post("webhooks")
  @Roles("admin")
  createWebhook(@Actor() actor: RequestActor, @Body(zodBody(CreateWebhookInput)) input: CreateWebhookInput) {
    return this.developers.createWebhook(actor.workspaceId, input);
  }

  @Delete("webhooks/:id")
  @Roles("admin")
  @HttpCode(204)
  async removeWebhook(@Actor() actor: RequestActor, @Param("id") id: string) {
    await this.developers.removeWebhook(actor.workspaceId, id);
  }
}
