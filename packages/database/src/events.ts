import { sql } from "drizzle-orm";
import type { Executor } from "./client.js";
import { auditLog } from "./schema/index.js";

/* ============================================================
   Workspace activity: the audit trail and the webhook queue.

   These live here rather than in apps/worker because apps/api is where the
   events actually happen, and apps/api does not depend on @snapurl/worker —
   adding that dependency to reach one function would invert the direction of
   the dependency graph and break --frozen-lockfile besides. Both apps already
   depend on @snapurl/database, so this is the one place both can reach.

   apps/worker still owns *delivery* (signing, backoff, health). It owns
   draining the queue; this file owns filling it.
   ============================================================ */

/** The events a webhook can subscribe to. Mirrors WEBHOOK_EVENTS in the
 *  contract — kept as a type here so packages/database need not depend on it. */
export type WebhookEvent =
  | "link.created"
  | "link.updated"
  | "link.deleted"
  | "link.clicked"
  | "conversion.recorded"
  | "domain.verified";

/**
 * Queue one event for every webhook in the workspace subscribed to it.
 *
 * Returns how many deliveries were queued, which is zero for a workspace with
 * no matching webhook — the overwhelmingly common case, and not an error.
 *
 * Call this *after* the transaction that made the change has committed. A
 * delivery enqueued inside the transaction is still queued if that transaction
 * later rolls back, and the receiver would be told about a link that does not
 * exist.
 */
export async function enqueueWebhookEvent(
  db: Executor,
  workspaceId: string,
  event: WebhookEvent,
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

export interface AuditEntryInput {
  workspaceId: string;
  actorId: string | null;
  actorLabel: string;
  /** Rendered into a sentence by describe() in members.service.ts. A key with
   *  no case there shows raw, so add one when you add an action. */
  action: string;
  targetType?: string | null;
  targetId?: string | null;
  metadata?: Record<string, unknown> | null;
}

/** Append one row to the workspace's audit trail. */
export async function writeAuditEntry(db: Executor, entry: AuditEntryInput): Promise<void> {
  await db.insert(auditLog).values({
    workspaceId: entry.workspaceId,
    actorId: entry.actorId,
    actorLabel: entry.actorLabel,
    action: entry.action,
    targetType: entry.targetType ?? null,
    targetId: entry.targetId ?? null,
    metadata: entry.metadata ?? null,
  });
}
