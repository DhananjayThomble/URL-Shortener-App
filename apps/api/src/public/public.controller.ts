import { Body, Controller, Get, HttpCode, Param, Post, Query } from "@nestjs/common";
import { UnlockLinkInput } from "@snapurl/contract";
import { zodBody } from "../common/zod.pipe.js";
import { Public } from "../auth/auth.guard.js";
import { PublicService } from "./public.service.js";

/* Every route here is unauthenticated, and each one says so individually.
   @Public() on the controller would mean one forgotten decorator on a future
   route silently exposes it. */
@Controller("public")
export class PublicController {
  constructor(private readonly publicService: PublicService) {}

  @Public()
  @Get("links/:slug/preview")
  preview(@Param("slug") slug: string, @Query("host") host?: string) {
    return this.publicService.preview(slug, host);
  }

  @Public()
  @Post("links/:slug/unlock")
  @HttpCode(200)
  unlock(
    @Param("slug") slug: string,
    @Body(zodBody(UnlockLinkInput)) input: UnlockLinkInput,
    @Query("host") host?: string,
  ) {
    return this.publicService.unlock(slug, input.password, host);
  }
}
