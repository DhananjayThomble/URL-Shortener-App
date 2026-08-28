import type { Logger } from "@nestjs/common";
import {
  enqueueWebhookEvent,
  writeAuditEntry,
  type Executor,
  type WebhookEvent,
} from "@snapurl/database";

/* ============================================================
   Recording that something happened.

   Two subsystems were fully built and never invoked: the audit trail, which
   the team page claims logs every action, and the webhook queue, which the
   worker has been draining every thirty seconds against nothing. Both are fed
   from the same handful of places, so they are fed by the same call.
   ============================================================ */

/** Who did it. Assembled from RequestActor at the controller boundary so the
 *  services stay free of auth types. `userId` is null for an API-key caller. */
export interface Actor {
  userId: string | null;
  label: string;
}

/** Narrow a RequestActor down to just who-did-it. Structural, so it takes any
 *  RequestActor without common/ having to import from auth/. */
export function toActor(actor: { userId: string | null; label: string }): Actor {
  return { userId: actor.userId, label: actor.label };
}

export interface ActivityInput {
  workspaceId: string;
  actor: Actor;
  /** Omit to emit a webhook without an audit row. */
  auditAction?: string;
  /** Omit to write an audit row without a webhook. */
  webhookEvent?: WebhookEvent;
  targetType?: string;
  targetId?: string;
  /** Goes to describe() for the audit sentence, and to the webhook body. */
  metadata?: Record<string, unknown>;
}

/**
 * Write the audit entry and queue the webhooks for one change.
 *
 * **This never throws.** The change it describes has already been committed,
 * so letting a failed audit insert or a failed enqueue bubble up would turn a
 * link that was successfully created into a 500 — the user retries, gets a
 * duplicate-slug conflict, and the operation looks broken when it worked. The
 * failure is logged instead, at error level, because a silently empty audit
 * trail is its own bug.
 *
 * Call it after the transaction commits, never inside it: a delivery queued in
 * a transaction that later rolls back tells a receiver about a link that does
 * not exist.
 */
export async function recordActivity(db: Executor, logger: Logger, input: ActivityInput): Promise<void> {
  const { workspaceId, actor, auditAction, webhookEvent, targetType, targetId, metadata } = input;

  if (auditAction) {
    try {
      await writeAuditEntry(db, {
        workspaceId,
        actorId: actor.userId,
        actorLabel: actor.label,
        action: auditAction,
        targetType: targetType ?? null,
        targetId: targetId ?? null,
        metadata: metadata ?? null,
      });
    } catch (err) {
      logger.error(`Failed to write audit entry "${auditAction}" for workspace ${workspaceId}`, err as Error);
    }
  }

  if (webhookEvent) {
    try {
      await enqueueWebhookEvent(db, workspaceId, webhookEvent, { id: targetId, ...metadata });
    } catch (err) {
      logger.error(`Failed to queue webhook "${webhookEvent}" for workspace ${workspaceId}`, err as Error);
    }
  }
}
