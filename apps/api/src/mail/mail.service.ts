import { Inject, Injectable, Logger } from "@nestjs/common";
import { SendEmailCommand, SESClient } from "@aws-sdk/client-ses";
import { mkdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { ENV, type Env } from "../config/env.js";

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
}

@Injectable()
export class MailService {
  private readonly logger = new Logger(MailService.name);
  private sesClient: SESClient | undefined;

  constructor(@Inject(ENV) private readonly env: Env) {}

  async send(message: MailMessage): Promise<void> {
    if (this.env.MAIL_TRANSPORT === "outbox") {
      const dir = this.env.MAIL_OUTBOX_DIR ?? resolve(tmpdir(), "snapurl-outbox");
      await mkdir(dir, { recursive: true });
      const file = resolve(dir, `${Date.now()}-${message.to.replace(/[^a-z0-9]/gi, "_")}.txt`);
      await writeFile(file, `To: ${message.to}\nSubject: ${message.subject}\n\n${message.body}\n`, "utf8");
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
}
