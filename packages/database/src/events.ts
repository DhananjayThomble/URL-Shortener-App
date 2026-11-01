import { sql } from "drizzle-orm";
import type { Executor } from "./client.js";
import type { AuditAction } from "@snapurl/domain";
import { adminAuditLog, auditLog } from "./schema/index.js";

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
  /** One of the closed set in @snapurl/domain, each of which has human copy
   *  (#783). The column is typed the same way, so a raw insert is held to it too. */
  action: AuditAction;
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

/* ============================================================
   #968 — the platform-admin audit trail (schema/admin.ts).

   Separate from the workspace trail above: a different table, a different
   actor (a platform admin, not a workspace member) and a different shape
   (before/after state + request IP, no workspace). Every platform-admin WRITE
   must go through writeAdminAuditEntry — it is the ONE helper the epic's later
   parts call, so the trail cannot grow holes from a handler that forgot.
   ============================================================ */

export interface AdminAuditEntryInput {
  /** The platform admin's user id, or null for an action with no user behind it. */
  actorId: string | null;
  /** The actor's email, retained even if the user row is later deleted. */
  actorLabel: string;
  /** A dotted action key, e.g. "admin.session.start". */
  action: string;
  targetType?: string | null;
  targetId?: string | null;
  /** State before the write, or null when there was none. */
  before?: unknown;
  /** State after the write, or null when the write removed it. */
  after?: unknown;
  /** The request's resolved client IP, or null for an action with no request. */
  requestIp?: string | null;
}

/**
 * Append one row to the platform-admin audit trail.
 *
 * Append-only: this inserts and never updates or deletes, and it is the only
 * writer of the table. Pass a transaction handle to record the action inside
 * the same transaction that applies it, so the action and its record either
 * both exist or neither does.
 */
export async function writeAdminAuditEntry(db: Executor, entry: AdminAuditEntryInput): Promise<void> {
  await db.insert(adminAuditLog).values({
    actorId: entry.actorId,
    actorLabel: entry.actorLabel,
    action: entry.action,
    targetType: entry.targetType ?? null,
    targetId: entry.targetId ?? null,
    before: entry.before ?? null,
    after: entry.after ?? null,
    requestIp: entry.requestIp ?? null,
  });
}
