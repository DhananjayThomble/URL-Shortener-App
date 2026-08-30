import { clickEvents } from "./schema/index.js";
import type { Database } from "./client.js";

/* ============================================================
   The click event, and the one INSERT that lands it.

   A click is recorded in two shapes across the codebase:

     - the redirect's PostgresClickSink writes it straight to
       click_events (single-node / k8s / compose);
     - on the AWS profile the redirect SqsClickSink sends it to a
       queue as JSON, and the worker's SQS consumer drains that
       queue back into the SAME click_events table.

   Both must produce byte-for-byte identical rows, so the column
   mapping lives here as one function and both paths call it. The
   ClickEvent type also lives here (rather than in the redirect)
   so the worker consumer can import it without depending on the
   redirect app. It is re-exported from apps/redirect/src/click-sink.ts
   so existing redirect importers are unchanged.
   ============================================================ */

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

/** The wire shape of a ClickEvent on the SQS queue: identical to ClickEvent
 *  except occurredAt is an ISO-8601 string (JSON has no Date). */
type SerializedClickEvent = Omit<ClickEvent, "occurredAt"> & { occurredAt: string };

/** Serialise a ClickEvent for an SQS MessageBody. The only non-JSON field is
 *  occurredAt, which becomes an ISO string; deserializeClickEvent reverses it. */
export function serializeClickEvent(event: ClickEvent): string {
  const wire: SerializedClickEvent = { ...event, occurredAt: event.occurredAt.toISOString() };
  return JSON.stringify(wire);
}

/** Revive a ClickEvent from an SQS record body, turning occurredAt back into a
 *  Date so the row inserted matches the one the redirect built. */
export function deserializeClickEvent(body: string): ClickEvent {
  const wire = JSON.parse(body) as SerializedClickEvent;
  return { ...wire, occurredAt: new Date(wire.occurredAt) };
}

/** The single INSERT path into click_events, shared by PostgresClickSink and
 *  the worker's SQS consumer so a click recorded either way is the same row.
 *  A no-op on an empty batch. */
export async function insertClickEvents(db: Database, events: ClickEvent[]): Promise<void> {
  if (events.length === 0) return;
  await db.insert(clickEvents).values(
    events.map((event) => ({
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
    })),
  );
}
