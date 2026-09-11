import { Inject, Injectable, Logger } from "@nestjs/common";
import { InvocationType, InvokeCommand, LambdaClient } from "@aws-sdk/client-lambda";
import { ENV, type Env } from "../config/env.js";

/* #394 — closing the ~60s window between "link created" and "link resolvable".
   projectionOutbox rows are drained on the worker's 1-minute EventBridge
   schedule (see apps/worker/src/jobs/outbox.ts), which is correct for
   durability (a crashed worker's rows are simply picked up next tick) but
   means a link created right after a drain tick sits unresolvable — a 404 —
   for up to a minute. The redirect deliberately does not fall back to
   Postgres to paper over this: leaving Postgres entirely is the point of the
   AWS profile (#288 3b), and reintroducing it here for a bugfix would quietly
   undo that.

   Instead: every projectionOutbox insert also fires an async Invoke of the
   worker Lambda with {"task":"projection"} (a dedicated task that runs only
   runProjection, not the full frequent job — see apps/worker/src/lambda.ts).
   InvocationType "Event" returns as soon as Lambda has accepted the request,
   before the function runs, so this never adds latency to the link-create
   response, and a failure to invoke (throttled, transient network blip) is
   swallowed and logged — the row is still in the outbox and the next
   scheduled drain picks it up regardless. This is a latency optimization
   layered on an already-durable path, not a new source of truth. */

@Injectable()
export class ProjectionNudgeService {
  private readonly logger = new Logger(ProjectionNudgeService.name);
  private client: LambdaClient | undefined;

  constructor(@Inject(ENV) private readonly env: Env) {}

  /** Fire-and-forget: never throws, never awaited by the caller's transaction.
   *  A no-op when WORKER_FUNCTION_NAME is unset (every non-AWS profile). */
  nudge(): void {
    const functionName = this.env.WORKER_FUNCTION_NAME;
    if (!functionName) return;

    this.client ??= new LambdaClient({});
    this.client
      .send(
        new InvokeCommand({
          FunctionName: functionName,
          InvocationType: InvocationType.Event,
          Payload: Buffer.from(JSON.stringify({ task: "projection" })),
        }),
      )
      .catch((err: unknown) => {
        /* Warn, not error: the outbox row is durable and the scheduled drain
           still runs within a minute regardless. This only means the request
           did not get to skip the queue. */
        this.logger.warn({ err }, "projection nudge invoke failed; scheduled drain will still pick up the row");
      });
  }
}
