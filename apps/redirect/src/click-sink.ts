import { clickEvents, type Database } from "@snapurl/database";

/* Where a click goes after the visitor has already been redirected.

   In production this is an SQS SendMessage — the queue absorbs the write so
   the redirect never waits on a database, and the rollup worker drains it in
   batches. Locally it writes straight to Postgres, which keeps the whole
   pipeline runnable with one container and no AWS account.

   Both are fire-and-forget from the caller's point of view. */

export interface ClickEvent {
  linkId: string;
  workspaceId: string;
  occurredAt: Date;
  visitorHash: string;
  country: string | null;
  city: string | null;
  device: string | null;
  browser: string | null;
  os: string | null;
  referrerHost: string | null;
  isQr: boolean;
  isBot: boolean;
  blockedReason: string | null;
  matchedRuleId: string | null;
  variant: string | null;
}

export interface ClickSink {
  record(event: ClickEvent): Promise<void>;
}

export class PostgresClickSink implements ClickSink {
  constructor(private readonly db: Database) {}

  async record(event: ClickEvent): Promise<void> {
    await this.db.insert(clickEvents).values({
      linkId: event.linkId,
      workspaceId: event.workspaceId,
      occurredAt: event.occurredAt,
      visitorHash: event.visitorHash,
      country: event.country,
      city: event.city,
      device: event.device,
      browser: event.browser,
      os: event.os,
      referrerHost: event.referrerHost,
      isQr: event.isQr,
      isBot: event.isBot,
      blockedReason: event.blockedReason,
      matchedRuleId: event.matchedRuleId,
      variant: event.variant,
    });
  }
}
