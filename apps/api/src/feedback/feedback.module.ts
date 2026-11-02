import { Module } from "@nestjs/common";
import { FeedbackService } from "./feedback.service.js";
import { AuthModule } from "../auth/auth.module.js";

/* #997 — in-app "Report a problem". The unauthenticated intake route lives on
   PublicController (mirroring the convention that every /public route is
   declared there), so this module provides the service and exports it for
   PublicModule to share one instance. The admin inbox is a separate service
   (AdminFeedbackService) mounted on AdminController behind AdminGuard.

   AuthModule is imported for TokenService: the intake best-effort verifies a
   bearer token to attach a signed-in submitter's context without making the
   route require auth. MailService is global (MailModule). */
@Module({
  imports: [AuthModule],
  providers: [FeedbackService],
  exports: [FeedbackService],
})
export class FeedbackModule {}
