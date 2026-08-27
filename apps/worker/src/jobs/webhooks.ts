import { createHmac } from "node:crypto";
import { sql, type Database } from "@snapurl/database";

/* ============================================================
   Webhook delivery with exponential backoff.

   Deliveries are rows, not in-memory retries: a worker that
   crashes mid-backoff must not lose the queue, and "which of my
   webhooks is failing and why" is a question the Developers page
   asks of the database.
   ============================================================ */

/** 1m, 5m, 25m, 2h, 10h — then the delivery is marked failed and left alone. */
const BACKOFF_MINUTES = [1, 5, 25, 120, 600];
const MAX_ATTEMPTS = BACKOFF_MINUTES.length;

interface PendingDelivery {
  id: string;
  webhook_id: string;
  event: string;
  payload: unknown;
  attempts: number;
  endpoint: string;
  secret: string;
}

/**
 * Sign the payload so the receiver can prove it came from us.
 *
 * The timestamp is inside the signed material, so a captured delivery cannot
 * be replayed against the receiver hours later — the same scheme Stripe uses,
 * because receivers already know how to verify it.
 */
export function signPayload(secret: string, timestamp: number, body: string): string {
  return createHmac("sha256", secret).update(`${timestamp}.${body}`).digest("hex");
}

export async function deliverWebhooks(db: Database, batchSize = 50): Promise<{ sent: number; failed: number }> {
  const rows = (await db.execute(sql`
    select d.id, d.webhook_id, d.event, d.payload, d.attempts, w.endpoint, w.secret
    from webhook_deliveries d
    join webhooks w on w.id = d.webhook_id
    where d.status = 'pending'
      and (d.next_retry_at is null or d.next_retry_at <= now())
      and w.disabled_at is null
    order by d.created_at
    limit ${batchSize}
    for update of d skip locked
  `)) as unknown as PendingDelivery[];

  let sent = 0;
  let failed = 0;

  for (const row of rows) {
    const body = JSON.stringify({ event: row.event, data: row.payload });
    const timestamp = Math.floor(Date.now() / 1000);

    try {
      const response = await fetch(row.endpoint, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-SnapURL-Event": row.event,
          "X-SnapURL-Timestamp": String(timestamp),
          "X-SnapURL-Signature": signPayload(row.secret, timestamp, body),
        },
        body,
        // A receiver that takes longer than ten seconds is a receiver that
        // will take longer than ten seconds again. Retry rather than hold.
        signal: AbortSignal.timeout(10_000),
      });

      if (response.ok) {
        await db.execute(sql`
          update webhook_deliveries
          set status = 'delivered', delivered_at = now(), attempts = attempts + 1,
              response_code = ${response.status}, next_retry_at = null
          where id = ${row.id}::uuid
        `);
        await db.execute(sql`
          update webhooks
          set health = 'healthy', consecutive_failures = 0, last_delivery_at = now(), last_error = null
          where id = ${row.webhook_id}::uuid
        `);
        sent++;
        continue;
      }

      await recordFailure(db, row, `HTTP ${response.status}`, response.status);
      failed++;
    } catch (err) {
      await recordFailure(db, row, String(err).slice(0, 300), null);
      failed++;
    }
  }

  return { sent, failed };
}

async function recordFailure(db: Database, row: PendingDelivery, error: string, code: number | null) {
  const attempts = row.attempts + 1;
  const exhausted = attempts >= MAX_ATTEMPTS;
  const delayMinutes = BACKOFF_MINUTES[Math.min(attempts, BACKOFF_MINUTES.length - 1)]!;

  await db.execute(sql`
    update webhook_deliveries
    set attempts = ${attempts},
        status = ${exhausted ? "failed" : "pending"},
        error = ${error},
        response_code = ${code},
        next_retry_at = ${exhausted ? null : sql`now() + (${delayMinutes} * interval '1 minute')`}
    where id = ${row.id}::uuid
  `);

  /* Health is derived from consecutive failures rather than set by hand, so
     it cannot drift out of step with what actually happened. */
  await db.execute(sql`
    update webhooks
    set consecutive_failures = consecutive_failures + 1,
        last_delivery_at = now(),
        last_error = ${error},
        health = case
          when consecutive_failures + 1 >= ${MAX_ATTEMPTS} then 'failing'
          else 'retrying'
        end
    where id = ${row.webhook_id}::uuid
  `);
}

/** Enqueue an event for every webhook subscribed to it. */
export async function enqueueEvent(
  db: Database,
  workspaceId: string,
  event: string,
  payload: unknown,
): Promise<number> {
  const result = (await db.execute(sql`
    with queued as (
      insert into webhook_deliveries (webhook_id, event, payload)
      select id, ${event}, ${JSON.stringify(payload)}::jsonb
      from webhooks
      where workspace_id = ${workspaceId}::uuid
        and disabled_at is null
        and ${event} = any(events)
      returning 1
    )
    select count(*)::int as n from queued
  `)) as unknown as [{ n: number }];
  return result[0]?.n ?? 0;
}

/** Delivered rows are history nobody reads after a week. */
export async function pruneDeliveries(db: Database): Promise<number> {
  const result = (await db.execute(sql`
    with dropped as (
      delete from webhook_deliveries
      where status = 'delivered' and delivered_at < now() - interval '7 days'
      returning 1
    )
    select count(*)::int as n from dropped
  `)) as unknown as [{ n: number }];
  return result[0]?.n ?? 0;
}
