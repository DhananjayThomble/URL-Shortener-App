import { Inject, Injectable, Logger, Optional } from "@nestjs/common";
import { SendEmailCommand, SESClient } from "@aws-sdk/client-ses";
import { mkdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { ENV, type Env } from "../config/env.js";
import { KillSwitchService } from "../admin/kill-switch.service.js";

/* Email has two transports (docs/DECISIONS.md A11).

   `outbox` writes each message to os.tmpdir()/snapurl-outbox by default
   (writable on Lambda, whose filesystem is read-only except for /tmp),
   overridable via MAIL_OUTBOX_DIR, so invitations are testable end to end
   without a mail provider — the default everywhere until an operator opts in.

   `ses` sends through Amazon SES. Wiring the SDK call is the easy part; the
   two things that actually gate it are AWS-console steps no code can do:
   verifying the sending domain/identity in SES (DKIM CNAME records), and
   requesting production access (a fresh account starts in the SES sandbox,
   which only delivers to addresses you've individually verified — every real
   invite recipient would silently fail until that's granted). MAIL_FROM must
   be an address on the verified identity, or SES rejects the send outright.

   The client takes no explicit region: on Lambda, AWS_REGION is already set
   by the execution environment, and the SDK reads it by default — matching
   how DynamoDB/SQS clients elsewhere in this codebase (apps/worker,
   apps/redirect) are constructed. MailerPort is the seam; this is the second
   of its two adapters. */

export interface MailMessage {
  to: string;
  subject: string;
  body: string;
  /** #1020 — true for auth-critical mail (verification, password reset) that
   *  may BYPASS the email.outbound OFF switch. It is still counted against the
   *  hourly/daily caps and refused past them. Defaults to false: every other
   *  message is ordinary outbound mail, blocked while the switch is off. */
  authCritical?: boolean;
}

@Injectable()
export class MailService {
  private readonly logger = new Logger(MailService.name);
  private sesClient: SESClient | undefined;

  constructor(
    @Inject(ENV) private readonly env: Env,
    /** #1020 — the email.outbound kill switch + hourly/daily caps. Every send
     *  is gated here, the one choke point for outbound mail. Auth-critical mail
     *  bypasses the OFF switch (documented below and in the admin UI) but stays
     *  capped. OPTIONAL so a focused unit test can construct MailService with no
     *  switch and exercise the transport directly — when absent, no gate runs
     *  (today's behaviour); under real DI it is always injected. */
    @Optional() private readonly killSwitches?: KillSwitchService,
  ) {}

  /**
   * Send one message, gated by the #1020 email.outbound kill switch.
   *
   * ORDER MATTERS: the switch + caps are checked BEFORE the transport runs, so
   * a switched-off (or capped) send makes no SES call and writes no outbox
   * file — "a switched-off feature changes nothing". A refusal throws
   * (KillSwitchOffError 503 / KillSwitchCapError 403); the caller decides
   * whether that is fatal (an auth flow) or best-effort (a notification).
   *
   * AUTH-CRITICAL BYPASS (documented, #1020): a message marked authCritical
   * (email verification, password reset) is allowed through even when
   * email.outbound is OFF — a user must still be able to verify or reset — but
   * it is STILL counted against the hourly and daily caps and refused past
   * them, so a reset storm cannot run up an unbounded bill. This exception is
   * surfaced in the admin Kill switches page beside the email.outbound toggle.
   */
  async send(message: MailMessage): Promise<void> {
    const authCritical = message.authCritical ?? false;

    // When the kill switch is wired (always, under real DI), gate the send; a
    // refusal throws before any transport runs. A focused unit test may omit it.
    if (this.killSwitches) {
      await this.killSwitches.assertEmailAllowed(authCritical);
    }

    await this.deliver(message);

    // Count the send only after it actually happened, for the rolling caps.
    if (this.killSwitches) {
      await this.killSwitches.recordSentEmail(authCritical);
    }
  }

  /** The transport, split out so the kill-switch gate in {@link send} wraps
   *  every path. Unchanged from the original send body. */
  private async deliver(message: MailMessage): Promise<void> {
    if (this.env.MAIL_TRANSPORT === "outbox") {
      const dir = this.env.MAIL_OUTBOX_DIR ?? resolve(tmpdir(), "snapurl-outbox");
      // Messages carry single-use invite/reset tokens, and the default dir sits
      // in the shared os temp dir, so keep both the dir and files owner-only.
      await mkdir(dir, { recursive: true, mode: 0o700 });
      const file = resolve(dir, `${Date.now()}-${message.to.replace(/[^a-z0-9]/gi, "_")}.txt`);
      await writeFile(file, `To: ${message.to}\nSubject: ${message.subject}\n\n${message.body}\n`, {
        encoding: "utf8",
        mode: 0o600,
      });
      this.logger.log({ to: message.to, file }, "mail written to outbox");
      return;
    }

    this.sesClient ??= new SESClient({});
    await this.sesClient.send(
      new SendEmailCommand({
        Source: this.env.MAIL_FROM,
        Destination: { ToAddresses: [message.to] },
        Message: {
          Subject: { Data: message.subject, Charset: "UTF-8" },
          Body: { Text: { Data: message.body, Charset: "UTF-8" } },
        },
      }),
    );
    this.logger.log({ to: message.to }, "mail sent via SES");
  }

  async sendInvite(opts: { to: string; token: string; invitedBy: string }): Promise<void> {
    const url = `${this.env.WEB_ORIGIN}/invite?token=${opts.token}`;
    await this.send({
      to: opts.to,
      subject: `${opts.invitedBy} invited you to a SnapURL workspace`,
      body: `${opts.invitedBy} added you to their SnapURL workspace.\n\nAccept the invitation:\n${url}\n\nThe link expires in 7 days.`,
    });
  }

  /* P0 — password reset. Same transport seam as invites. The link carries an
     opaque single-use token; the token's hash is what's stored server-side. */
  async sendPasswordReset(opts: { to: string; token: string }): Promise<void> {
    const url = `${this.env.WEB_ORIGIN}/reset-password?token=${opts.token}`;
    await this.send({
      to: opts.to,
      // #1020 — auth-critical: a user locked out must be able to reset even
      // while outbound mail is paused. Still capped.
      authCritical: true,
      subject: "Reset your SnapURL password",
      body:
        `Someone asked to reset the password for this SnapURL account.\n\n` +
        `Reset it here:\n${url}\n\n` +
        `The link expires in 1 hour and can be used once. ` +
        `If you didn't request this, you can safely ignore this email — your password won't change.`,
    });
  }

  /* #994 point 3 — a link the owner created was auto-disabled after reaching
     the abuse-report threshold, pending admin review. The owner is told which
     link and why, and where to appeal — never the reporters' identities. */
  async sendLinkQuarantined(opts: { to: string; shortUrl: string; destination: string }): Promise<void> {
    await this.send({
      to: opts.to,
      subject: "A SnapURL link was disabled after abuse reports",
      body:
        `One of your SnapURL links has been automatically disabled after multiple abuse reports, ` +
        `pending review by our team.\n\n` +
        `Short link: ${opts.shortUrl}\n` +
        `Destination: ${opts.destination}\n\n` +
        `While disabled, the link stops redirecting and shows a "link disabled" page. ` +
        `If you believe this was a mistake, reply to this email or contact support and we'll review it.`,
    });
  }

  /* #989 — a subscription charge failed. The plan stays active through a grace
     window; the owner is told when it lapses and where to fix their card. No
     amounts or card details — that data never touches SnapURL. */
  async sendPaymentFailed(opts: { to: string; graceEndsAt: Date }): Promise<void> {
    const when = opts.graceEndsAt.toISOString().slice(0, 10);
    const url = `${this.env.WEB_ORIGIN}/settings/billing`;
    await this.send({
      to: opts.to,
      subject: "Your SnapURL payment failed — action needed",
      body:
        `We couldn't process the latest payment for your SnapURL subscription.\n\n` +
        `Your paid plan stays active until ${when}. Update your payment method before then to keep it — ` +
        `after that date the workspace moves to the Free plan. Your links and data are kept either way; ` +
        `only paid features pause.\n\n` +
        `Update your payment method:\n${url}`,
    });
  }

  /* P0 — email verification. Confirms the address at sign-up (and on resend). */
  async sendEmailVerification(opts: { to: string; token: string }): Promise<void> {
    const url = `${this.env.WEB_ORIGIN}/verify-email?token=${opts.token}`;
    await this.send({
      to: opts.to,
      // #1020 — auth-critical: email verification must go out even while
      // outbound mail is paused (verification gates sign-up). Still capped.
      authCritical: true,
      subject: "Verify your SnapURL email",
      body:
        `Welcome to SnapURL! Confirm this is your email address:\n\n${url}\n\n` +
        `The link expires in 24 hours. If you didn't create a SnapURL account, ignore this email.`,
    });
  }
}
