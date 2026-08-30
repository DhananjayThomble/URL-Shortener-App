import {
  insertClickEvents,
  serializeClickEvent,
  type ClickEvent,
  type Database,
} from "@snapurl/database";
import { SQSClient, SendMessageCommand } from "@aws-sdk/client-sqs";

/* Where a click goes after the visitor has already been redirected.

   In production this is an SQS SendMessage — the queue absorbs the write so
   the redirect never waits on a database, and the rollup worker drains it in
   batches. Locally it writes straight to Postgres, which keeps the whole
   pipeline runnable with one container and no AWS account.

   Both are fire-and-forget from the caller's point of view.

   The ClickEvent type and the single click_events INSERT now live in
   @snapurl/database so the worker's SQS consumer can drain the queue back into
   the SAME table with byte-for-byte identical rows without depending on this
   app. ClickEvent is re-exported here so existing redirect importers are
   unchanged. */
export type { ClickEvent };

export interface ClickSink {
  record(event: ClickEvent): Promise<void>;
}

export class PostgresClickSink implements ClickSink {
  /** `onRetry` surfaces a click that had to be re-inserted because a concurrent
   *  partition ATTACH invalidated its route (#329). Optional so a test can build
   *  the sink with a bare handle; main.ts wires it to the app logger, because a
   *  retry firing constantly means partition provisioning has stopped and the
   *  DEFAULT partition is absorbing live traffic. */
  constructor(
    private readonly db: Database,
    private readonly onRetry?: (err: unknown) => void,
  ) {}

  async record(event: ClickEvent): Promise<void> {
    await insertClickEvents(this.db, [event], { onRetry: this.onRetry });
  }
}

/* The production click sink: an SQS SendMessage.

   record() AWAITS the send. That await is the freeze-safe write #277 wants: an
   SQS HTTP send is a request that completes and is acknowledged before the
   Lambda Web Adapter sandbox freezes on the response, so the click is durably
   on the queue by the time the invocation ends. A Postgres INSERT does not
   survive that freeze the same way — a fire-and-forget query is suspended
   mid-flight and pins a backend the pool cannot reclaim (see the record()
   comment in main.ts). Awaiting one same-region HTTPS round trip is cheap and
   the write is durable.

   One SendMessage per click is correct here: main.ts awaits exactly one
   record() per request, so there is no batch to build. SendMessageBatch (the
   10-message batch API) would only help a caller buffering many clicks before
   flushing, which the request-scoped hot path never does.

   The client and queue URL are injected via the constructor so a unit test can
   drive it with a mocked SQSClient.send keyed by command name, mirroring
   DynamoDbCacheStore. */
export class SqsClickSink implements ClickSink {
  constructor(
    private readonly client: SQSClient,
    private readonly queueUrl: string,
  ) {}

  async record(event: ClickEvent): Promise<void> {
    await this.client.send(
      new SendMessageCommand({
        QueueUrl: this.queueUrl,
        MessageBody: serializeClickEvent(event),
      }),
    );
  }
}
