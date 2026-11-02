import { lt, sql } from "drizzle-orm";
import type { Executor } from "./client.js";
import type { AuditAction } from "@snapurl/domain";
import { adminAuditLog, auditLog, killSwitchRefusalWindow } from "./schema/index.js";

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


/* ============================================================
   #1032 — recording a kill-switch REFUSAL on the platform audit trail.

   A refusal (a switched-off 503 or a cap-reached 403) must leave a row with
   action `admin.killswitch.refused`, the switch key, the stable reason and the
   actor/workspace ids when known — but it must NOT let an abuse wave flood the
   audit table. So this writes AT MOST ONE admin_audit_log row per
   (switch, reason, subject) per minute, carrying a count.

   Mechanism: an upsert into kill_switch_refusal_window keyed on the
   deterministic dedupe key. The first refusal in a window INSERTs the row
   (count 1) and we then append the single admin_audit_log row; every later
   refusal in the same window hits the ON CONFLICT branch, bumps `count` and
   `last_at`, and writes no audit row. The returned row's `count` tells the two
   apart, so there is no second read and the whole thing is one statement plus,
   on the first hit only, the audit insert.
   ============================================================ */

/** A kill-switch refusal to record. `switchKey`/`reason` are the stable codes
 *  from @snapurl/contract; `dedupeKey` is killSwitchRefusalDedupeKey(...) from
 *  the same module (computed by the caller so the DB package stays free of the
 *  runtime contract import). The subject ids are optional — a refusal with no
 *  known principal is still recorded, attributed to the switch alone. No PII
 *  beyond ids and the actor's own label is ever passed or stored. */
export interface KillSwitchRefusalRecord {
  dedupeKey: string;
  switchKey: string;
  reason: string;
  actorId?: string | null;
  actorLabel?: string | null;
  workspaceId?: string | null;
}

/**
 * Record one kill-switch refusal, deduped to one audit row per window.
 *
 * Returns the window's running count AND whether this call wrote the window's
 * audit row (true only for the first refusal in the window). The caller never
 * needs the return — it is there for the tests, which assert that a flood makes
 * one row and a counter, not N rows.
 *
 * This THROWS on a DB failure, on purpose: the KillSwitchService calls it in a
 * try/catch and swallows the throw (logging it) so that an audit-write failure
 * never turns a refusal into a success and never turns the 503/403 into a 500.
 * Keeping the throw here lets the service decide the fail-closed behaviour in
 * one place, and lets a test assert the swallow.
 */
export async function recordKillSwitchRefusal(
  db: Executor,
  entry: KillSwitchRefusalRecord,
): Promise<{ count: number; auditWritten: boolean }> {
  const now = new Date();
  const [row] = await db
    .insert(killSwitchRefusalWindow)
    .values({
      dedupeKey: entry.dedupeKey,
      switchKey: entry.switchKey,
      reason: entry.reason,
      workspaceId: entry.workspaceId ?? null,
      actorId: entry.actorId ?? null,
      count: 1,
      firstAt: now,
      lastAt: now,
    })
    .onConflictDoUpdate({
      target: killSwitchRefusalWindow.dedupeKey,
      set: {
        count: sql`${killSwitchRefusalWindow.count} + 1`,
        lastAt: now,
      },
    })
    .returning({ count: killSwitchRefusalWindow.count });

  const count = row?.count ?? 1;
  // count === 1 is exactly the INSERT path (a fresh window): write the one row.
  const auditWritten = count === 1;
  if (auditWritten) {
    await writeAdminAuditEntry(db, {
      actorId: entry.actorId ?? null,
      // actor_label is NOT NULL; a refusal with no known principal is still a
      // real event, labelled by the switch so the trail is never anonymous.
      actorLabel: entry.actorLabel ?? `kill-switch:${entry.switchKey}`,
      action: "admin.killswitch.refused",
      targetType: "kill_switch",
      targetId: entry.switchKey,
      // reason + workspace ride in `after`; NO email, IP or request body. The
      // audit viewer filters on action/targetId, so these are context only.
      after: { reason: entry.reason, workspaceId: entry.workspaceId ?? null },
      requestIp: null,
    });
  }
  return { count, auditWritten };
}

/** Prune kill-switch refusal windows older than `olderThanMs`. A window is a
 *  rolling one-minute aggregate; once well past, the row is dead weight (only
 *  the upsert and this pruner ever touch the table). Returns the rows removed.
 *  Called from the worker's hourly maintenance pass alongside the other
 *  rolling-window prunes. */
export async function pruneKillSwitchRefusalWindows(db: Executor, olderThanMs: number): Promise<number> {
  const cutoff = new Date(Date.now() - olderThanMs);
  const deleted = await db
    .delete(killSwitchRefusalWindow)
    .where(lt(killSwitchRefusalWindow.firstAt, cutoff))
    .returning({ id: killSwitchRefusalWindow.id });
  return deleted.length;
}
