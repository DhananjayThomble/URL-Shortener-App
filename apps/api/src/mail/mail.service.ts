import { Inject, Injectable, Logger } from "@nestjs/common";
import { mkdir, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { ENV, type Env } from "../config/env.js";

/* Email is stubbed by design (docs/DECISIONS.md A11).

   SES needs a verified domain and a sandbox-exit request, neither of which I
   can do from here. The outbox transport writes each message to
   logs/outbox/ so invitations and resets are testable end to end without a
   mail provider. MailerPort is the seam — wiring SES is one adapter. */

export interface MailMessage {
  to: string;
  subject: string;
  body: string;
}

@Injectable()
export class MailService {
  private readonly logger = new Logger(MailService.name);

  constructor(@Inject(ENV) private readonly env: Env) {}

  async send(message: MailMessage): Promise<void> {
    if (this.env.MAIL_TRANSPORT === "outbox") {
      const dir = resolve(process.cwd(), "logs/outbox");
      await mkdir(dir, { recursive: true });
      const file = resolve(dir, `${Date.now()}-${message.to.replace(/[^a-z0-9]/gi, "_")}.txt`);
      await writeFile(file, `To: ${message.to}\nSubject: ${message.subject}\n\n${message.body}\n`, "utf8");
      this.logger.log({ to: message.to, file }, "mail written to outbox");
      return;
    }
    this.logger.warn("SES transport is not wired yet; message dropped");
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
