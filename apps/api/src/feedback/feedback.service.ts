import { Inject, Injectable, Logger } from "@nestjs/common";
import { feedback, type Database } from "@snapurl/database";
import { SubmitFeedbackInput, type SubmitFeedbackResult } from "@snapurl/contract";
import { DB } from "../database/database.module.js";
import { ENV, type Env, platformAdminEmails } from "../config/env.js";
import { MailService } from "../mail/mail.service.js";
import { TokenService } from "../auth/token.service.js";

/* ============================================================
   In-app "Report a problem" intake — #997.

   The public, UNAUTHENTICATED intake for product feedback. A signed-out
   visitor on a public page can file a report in two clicks; a signed-in user's
   account context (user id, workspace id, email) is attached automatically.

   "Automatically" means SERVER-SIDE from the caller's own session, never from
   the request body: the body carries only the free text and the client-visible
   context (page, app version, an optional error-tracking event id, an optional
   screenshot). The submitter identity is resolved by best-effort verifying the
   bearer token when one is present — a missing, invalid or API-key credential
   simply yields an anonymous report rather than being rejected, so the route
   stays open to signed-out visitors. A client cannot forge another user's id
   into a report because the id is never read from the body.

   Every new report emails the operator through the existing mail transport
   (outbox by default, SES in production), so it is testable end to end via the
   outbox without a mail provider.
   ============================================================ */
@Injectable()
export class FeedbackService {
  private readonly logger = new Logger(FeedbackService.name);

  constructor(
    @Inject(DB) private readonly db: Database,
    @Inject(ENV) private readonly env: Env,
    private readonly mail: MailService,
    private readonly tokens: TokenService,
  ) {}

  /**
   * Store a feedback report and notify the operator.
   *
   * `authorization` is the raw Authorization header the controller forwards, so
   * the submitter context can be resolved for a signed-in report WITHOUT making
   * the route require auth. `userAgent` is the browser string the controller
   * reads from the request headers (captured server-side, not trusted from the
   * body). The response carries the created id so the client can confirm the
   * send; there is no enumeration concern here (feedback names no short link),
   * so a straightforward ack is fine.
   */
  async submit(input: SubmitFeedbackInput, authorization?: string, userAgent?: string): Promise<SubmitFeedbackResult> {
    const submitter = await this.resolveSubmitter(authorization);

    // The body's reporterEmail is only used for a signed-OUT report (where the
    // reporter may have typed a contact). For a signed-in report the account
    // email from the verified session wins — never a body-supplied address.
    const bodyEmail = input.reporterEmail?.trim() ? input.reporterEmail.trim() : null;
    const reporterEmail = submitter?.email ?? bodyEmail;

    // Empty-string context fields are stored as null ("not provided").
    const page = emptyToNull(input.page);
    const appVersion = emptyToNull(input.appVersion);
    const errorEventId = emptyToNull(input.errorEventId);
    const ua = emptyToNull(userAgent);

    const [row] = await this.db
      .insert(feedback)
      .values({
        message: input.message,
        page,
        userAgent: ua,
        appVersion,
        errorEventId,
        screenshot: input.screenshot ?? null,
        userId: submitter?.userId ?? null,
        workspaceId: submitter?.workspaceId ?? null,
        reporterEmail,
        status: "new",
      })
      .returning({ id: feedback.id });

    const id = row!.id;

    // Notify the operator. Best-effort: a mail failure must never fail the
    // intake (the report is already stored and will show in the admin inbox).
    try {
      await this.notifyOperator({ id, message: input.message, page, errorEventId, reporterEmail });
    } catch (err) {
      this.logger.error({ err, id }, "failed to send feedback operator notification");
    }

    return { ok: true, id };
  }

  /**
   * Resolve the signed-in submitter from the bearer token, best effort.
   *
   * Returns null for any of: no header, a non-session credential (an API key,
   * prefixed `snap_`, has no user/workspace behind it the way a session does),
   * or a token that does not verify. The whole point is that failure degrades
   * to an anonymous report rather than a 401 — the route is @Public.
   */
  private async resolveSubmitter(
    authorization?: string,
  ): Promise<{ userId: string; workspaceId: string; email: string } | null> {
    if (!authorization?.startsWith("Bearer ")) return null;
    const credential = authorization.slice(7).trim();
    // API keys are not a person filing feedback; only a user session carries
    // the userId/workspaceId/email this attaches.
    if (credential.startsWith("snap_")) return null;
    try {
      const claims = await this.tokens.verifyAccessToken(credential);
      return { userId: claims.sub, workspaceId: claims.wid, email: claims.email };
    } catch {
      return null;
    }
  }

  /** Who the operator email goes to: an explicit FEEDBACK_NOTIFY_EMAIL, else
   *  the first platform-admin email, else nobody (no email, row still stored). */
  private operatorRecipient(): string | null {
    const explicit = this.env.FEEDBACK_NOTIFY_EMAIL?.trim();
    if (explicit) return explicit;
    const [first] = platformAdminEmails(this.env.PLATFORM_ADMIN_EMAILS);
    return first ?? null;
  }

  private async notifyOperator(opts: {
    id: string;
    message: string;
    page: string | null;
    errorEventId: string | null;
    reporterEmail: string | null;
  }): Promise<void> {
    const to = this.operatorRecipient();
    if (!to) {
      this.logger.warn({ id: opts.id }, "no feedback notification recipient configured; report stored only");
      return;
    }

    const lines = [
      "A new problem report was submitted in SnapURL.",
      "",
      `Report id: ${opts.id}`,
      `From: ${opts.reporterEmail ?? "anonymous (signed-out visitor)"}`,
      `Page: ${opts.page ?? "(not provided)"}`,
    ];
    if (opts.errorEventId) lines.push(`Error event: ${opts.errorEventId}`);
    lines.push("", "Message:", opts.message, "", "Open the admin inbox to triage it.");

    await this.mail.send({
      to,
      subject: "New SnapURL problem report",
      body: lines.join("\n"),
    });
  }
}

/** A trimmed non-empty string, or null — the stored "not provided" value. */
function emptyToNull(v: string | undefined | null): string | null {
  if (v == null) return null;
  const t = v.trim();
  return t.length > 0 ? t : null;
}
