import { Inject, Injectable, Logger } from "@nestjs/common";
import type { SignupRefusalReason } from "@snapurl/contract";
import { writeAdminAuditEntry, type Database } from "@snapurl/database";
import { DB } from "../database/database.module.js";

/* ============================================================
   #993 — the sign-up / new-account refusal log.

   The issue's acceptance: "every refusal is logged with a reason code, so the
   admin panel can see it." The platform-admin audit trail (#974) is exactly
   that surface — AdminAuditPage already reads admin_audit_log and filters by
   action — so a refusal is one append there, needing no new table:

     action    = "admin.signup.refused"
     targetType = "signup"
     targetId   = the reason code (disposable_email, bot_challenge_missing, …)
     actorId    = null  (no account exists yet, or the cap is on an existing one)
     actorLabel = the attempted email (or workspace id for a cap), so an
                  operator can see WHO was refused without a second lookup.

   Append-only and best-effort: a refusal is a side record, so a failure to
   write it must NEVER turn a correct refusal into a 500 or, worse, let the
   action through. It is logged and swallowed.

   The actorLabel for a sign-up refusal is an email the caller typed; it is
   stored on the trail exactly as the admin audit trail stores every actor
   label. It is not a credential and the value is already going to be an account
   identifier if the sign-up proceeds, so recording it here leaks nothing new.
   ============================================================ */

@Injectable()
export class SignupRefusalService {
  private readonly logger = new Logger(SignupRefusalService.name);

  constructor(@Inject(DB) private readonly db: Database) {}

  /**
   * Record one refusal with its reason code. `subject` is the email that was
   * refused (sign-up) or the workspace id (a new-account cap); it is stored as
   * the actor label so the panel row names who was turned away. Never throws.
   */
  async record(reason: SignupRefusalReason, subject: string, requestIp?: string | null): Promise<void> {
    try {
      await writeAdminAuditEntry(this.db, {
        actorId: null,
        actorLabel: subject,
        action: "admin.signup.refused",
        targetType: "signup",
        targetId: reason,
        before: null,
        after: { reason },
        requestIp: requestIp ?? null,
      });
    } catch (err) {
      /* Best-effort: the refusal itself has already been decided by the caller.
         A failure to record it must not change that outcome. */
      this.logger.warn({ err, reason }, "failed to record a sign-up refusal");
    }
  }
}
