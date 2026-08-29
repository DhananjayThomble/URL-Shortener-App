import { Body, Controller, Get, HttpCode, Param, Post, Query } from "@nestjs/common";
import { Throttle } from "@nestjs/throttler";
import { SubmitFormInput, UnlockLinkInput } from "@snapurl/contract";
import { zodBody } from "../common/zod.pipe.js";
import { Public } from "../auth/auth.guard.js";
import { PublicService } from "./public.service.js";
import { FormsService } from "../forms/forms.service.js";

/* Every route here is unauthenticated, and each one says so individually.
   @Public() on the controller would mean one forgotten decorator on a future
   route silently exposes it. */
@Controller("public")
export class PublicController {
  constructor(
    private readonly publicService: PublicService,
    private readonly forms: FormsService,
  ) {}

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

  /* Forms.

     A draft or closed form 404s here rather than 403ing: whether a workspace
     has a form at an address is not a stranger's business. */
  @Public()
  @Get("forms/:slug")
  form(@Param("slug") slug: string) {
    return this.forms.publicForm(slug);
  }

  /* 200 with `ok: false` rather than a 400 for a validation failure. The
     caller is a person filling in a form, and per-field messages are the
     useful answer — a 400 would put them in the error branch of every client
     with nothing per-field to show. A missing form is still a 404. */

  /* The only unauthenticated *write* in the API, so it does not get to share
     the global 120/minute budget the read endpoints use.

     A form may declare 50 fields of 4,000 characters, so an accepted
     submission stores up to ~200 KB. At the global limit a single address
     could write roughly 24 MB a minute into someone else's workspace — a
     storage bill and a spam problem rather than a break-in, but neither is
     something the workspace opted into.

     Ten a minute is far more than a person filling in a form and far less
     than a script is worth writing. It is a floor, not a substitute for the
     proof-of-work or honeypot this will want if the endpoint is ever abused
     in earnest. */
  @Public()
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  @Post("forms/:slug")
  @HttpCode(200)
  submit(@Param("slug") slug: string, @Body(zodBody(SubmitFormInput)) input: SubmitFormInput) {
    return this.forms.submit(slug, input);
  }
}
