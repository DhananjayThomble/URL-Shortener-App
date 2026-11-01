import { Inject, Injectable } from "@nestjs/common";
import {
  and,
  count,
  eq,
  gte,
  ilike,
  lt,
  sql,
  adminAuditLog,
  auditLog,
  jobLeases,
  projectionOutbox,
  webhookDeliveries,
  writeAdminAuditEntry,
  type Database,
} from "@snapurl/database";
import type {
  AdminAuditPage,
  AdminAuditQuery,
  AdminBacklog,
  AdminBacklogs,
  AdminRetryResult,
  AdminServiceHealth,
  AdminServiceStatus,
} from "@snapurl/contract";
import { DB, READ_DB } from "../database/database.module.js";
import type { AdminIdentity } from "./admin.service.js";

/* ============================================================
   #974 — system health and operations.

   The read side (service status, backlog counts, audit viewers) runs on the
   read handle: it is pure reporting with no write that follows, so it is safe
   on a replica. The write side (the three retries) runs on the primary inside
   a transaction, and records its own admin-audit row in that SAME transaction
   via writeAdminAuditEntry — the action and its audit trail commit together or
   not at all, so a retry can never land unlogged.

   None of these touch product behaviour: the retries only move already-failed
   or overdue work back into the queue the workers already drain. They change
   no destination, no policy and no user data.
   ============================================================ */

/* The attempt ceiling the outbox drain gives up at (apps/worker/src/jobs/outbox.ts
   MAX_ATTEMPTS). A row at or past it is dead-lettered: the drain's claim query
   filters on attempts < this, so it will never be retried on its own. Kept in
   step here so "stuck" means exactly "the worker has stopped trying". */
const OUTBOX_MAX_ATTEMPTS = 8;

/* The webhook backoff ladder length (apps/worker/src/jobs/webhooks.ts
   MAX_ATTEMPTS = BACKOFF_MINUTES.length). A delivery is marked 'failed' once it
   is reached; a 'failed' row is never picked up again by deliverWebhooks. */

@Injectable()
export class AdminHealthService {
  constructor(
    @Inject(DB) private readonly db: Database,
    @Inject(READ_DB) private readonly readDb: Database,
  ) {}

  /* ---- service status ---------------------------------------------------- */

  /**
   * The state of every moving part the operator can see from the panel.
   *
   * api is `ok` by definition — this handler ran, so the API answered. The
   * other three have no separate heartbeat to read, so their state is derived
   * from the evidence the database already holds:
   *   • database — a trivial `select 1`; `down` if it throws.
   *   • worker — the background worker holds and renews job leases as it runs,
   *     so a lease touched recently is proof of life. No lease row at all is
   *     reported as `degraded` ("no signal") rather than `down`, because a
   *     freshly-provisioned platform simply has not run a leased job yet.
   *   • redirect — the edge is kept current by the outbox drain; a large or
   *     dead-lettered outbox backlog means the edge is serving stale config,
   *     which is the redirect path being degraded even while it answers.
   */
  async services(): Promise<AdminServiceHealth> {
    const services: AdminServiceStatus[] = [];

    services.push({ name: "api", state: "ok", detail: "Answering requests." });

    // database
    try {
      await this.readDb.execute(sql`select 1`);
      services.push({ name: "database", state: "ok", detail: "Reachable." });
    } catch (err) {
      services.push({ name: "database", state: "down", detail: `Unreachable: ${String(err).slice(0, 120)}` });
    }

    // worker — most-recently-touched lease
    const [lease] = await this.readDb
      .select({ lockedUntil: jobLeases.lockedUntil, acquiredAt: jobLeases.acquiredAt })
      .from(jobLeases)
      .orderBy(sql`greatest(coalesce(${jobLeases.acquiredAt}, 'epoch'), ${jobLeases.lockedUntil}) desc`)
      .limit(1);
    if (!lease) {
      services.push({ name: "worker", state: "degraded", detail: "No job lease recorded yet — no signal from the worker." });
    } else {
      // A lease is renewed each pass; one not touched within an hour means the
      // worker has not run recently.
      const lastSeen = Math.max(
        lease.acquiredAt ? lease.acquiredAt.getTime() : 0,
        lease.lockedUntil ? lease.lockedUntil.getTime() : 0,
      );
      const ageMinutes = (Date.now() - lastSeen) / 60_000;
      if (ageMinutes <= 60) {
        services.push({ name: "worker", state: "ok", detail: "Running — a job lease was renewed within the hour." });
      } else {
        services.push({
          name: "worker",
          state: "degraded",
          detail: `No job lease renewed in ${Math.floor(ageMinutes)} minutes.`,
        });
      }
    }

    // redirect edge — health of the projection the edge reads
    const [{ stuck }] = await this.readDb
      .select({ stuck: count() })
      .from(projectionOutbox)
      .where(and(sql`${projectionOutbox.processedAt} is null`, gte(projectionOutbox.attempts, OUTBOX_MAX_ATTEMPTS)));
    if ((stuck ?? 0) > 0) {
      services.push({
        name: "redirect",
        state: "degraded",
        detail: `${stuck} edge update(s) gave up — the edge may be serving stale destinations.`,
      });
    } else {
      services.push({ name: "redirect", state: "ok", detail: "Edge projection is up to date." });
    }

    return { services };
  }

  /* ---- backlog counts ---------------------------------------------------- */

  /** Real counts for the three backlogs, read straight off the live tables. */
  async backlogs(): Promise<AdminBacklogs> {
    const [outboxPending] = await this.readDb
      .select({ n: count() })
      .from(projectionOutbox)
      .where(and(sql`${projectionOutbox.processedAt} is null`, lt(projectionOutbox.attempts, OUTBOX_MAX_ATTEMPTS)));
    const [outboxStuck] = await this.readDb
      .select({ n: count() })
      .from(projectionOutbox)
      .where(and(sql`${projectionOutbox.processedAt} is null`, gte(projectionOutbox.attempts, OUTBOX_MAX_ATTEMPTS)));

    // A lease is "pending" (held) when its clock has not yet expired; "stuck"
    // when it is held past its expiry — a crashed holder that never released,
    // the exact condition the lease mechanism exists to recover from.
    const [leasesHeld] = await this.readDb
      .select({ n: count() })
      .from(jobLeases)
      .where(gte(jobLeases.lockedUntil, sql`now()`));
    const [leasesStuck] = await this.readDb
      .select({ n: count() })
      .from(jobLeases)
      .where(and(lt(jobLeases.lockedUntil, sql`now()`), sql`${jobLeases.holder} is not null`));

    const [whPending] = await this.readDb
      .select({ n: count() })
      .from(webhookDeliveries)
      .where(eq(webhookDeliveries.status, "pending"));
    const [whFailed] = await this.readDb
      .select({ n: count() })
      .from(webhookDeliveries)
      .where(eq(webhookDeliveries.status, "failed"));

    const backlogs: AdminBacklog[] = [
      { name: "projection_outbox", pending: outboxPending?.n ?? 0, stuck: outboxStuck?.n ?? 0 },
      { name: "job_leases", pending: leasesHeld?.n ?? 0, stuck: leasesStuck?.n ?? 0 },
      { name: "webhook_deliveries", pending: whPending?.n ?? 0, stuck: whFailed?.n ?? 0 },
    ];
    return { backlogs };
  }

  /* ---- retries (admin-only, audited) ------------------------------------- */

  /**
   * Re-queue every dead-lettered outbox row: reset its attempts to zero and
   * clear its claim and last error so the next drain picks it up again. Does
   * NOT touch rows still under the attempt ceiling — those are retrying on
   * their own and must not have their backoff reset out from under them.
   */
  async retryProjectionOutbox(admin: AdminIdentity, requestIp: string | null): Promise<AdminRetryResult> {
    return this.db.transaction(async (tx) => {
      const rows = (await tx.execute(sql`
        update projection_outbox
        set attempts = 0, claimed_at = null, last_error = null
        where processed_at is null and attempts >= ${OUTBOX_MAX_ATTEMPTS}
        returning id
      `)) as unknown as Array<{ id: string }>;
      const retried = rows.length;
      await writeAdminAuditEntry(tx, {
        actorId: admin.id,
        actorLabel: admin.email,
        action: "admin.projection_outbox.retry",
        targetType: "projection_outbox",
        targetId: null,
        before: { stuck: retried },
        after: { retried },
        requestIp,
      });
      return { retried };
    });
  }

  /**
   * Re-queue every failed webhook delivery: set it back to pending, reset its
   * attempts and clear the error and retry clock so the worker delivers it on
   * the next pass. Leaves 'pending' and 'delivered' rows alone.
   */
  async retryWebhookDeliveries(admin: AdminIdentity, requestIp: string | null): Promise<AdminRetryResult> {
    return this.db.transaction(async (tx) => {
      const rows = (await tx.execute(sql`
        update webhook_deliveries
        set status = 'pending', attempts = 0, error = null, response_code = null, next_retry_at = null
        where status = 'failed'
        returning id
      `)) as unknown as Array<{ id: string }>;
      const retried = rows.length;
      await writeAdminAuditEntry(tx, {
        actorId: admin.id,
        actorLabel: admin.email,
        action: "admin.webhook_deliveries.retry",
        targetType: "webhook_deliveries",
        targetId: null,
        before: { failed: retried },
        after: { retried },
        requestIp,
      });
      return { retried };
    });
  }

  /**
   * Release a stuck job lease by name: a lease still held (holder set) whose
   * clock has already expired is a crashed holder that never let go. Setting
   * lockedUntil to now() and clearing the holder lets the next worker pass take
   * it. A lease that is not expired, or does not exist, is left untouched and
   * reported as retried: 0 — releasing a live lease would let a second worker
   * run a job alongside the one that legitimately holds it.
   */
  async releaseJobLease(name: string, admin: AdminIdentity, requestIp: string | null): Promise<AdminRetryResult> {
    return this.db.transaction(async (tx) => {
      const rows = (await tx.execute(sql`
        update job_leases
        set locked_until = now(), holder = null, acquired_at = null
        where name = ${name} and holder is not null and locked_until < now()
        returning name
      `)) as unknown as Array<{ name: string }>;
      const retried = rows.length;
      await writeAdminAuditEntry(tx, {
        actorId: admin.id,
        actorLabel: admin.email,
        action: "admin.job_lease.release",
        targetType: "job_lease",
        targetId: name,
        before: { held: retried === 1 },
        after: { released: retried === 1 },
        requestIp,
      });
      return { retried };
    });
  }

  /* ---- audit viewers ----------------------------------------------------- */

  /** The platform-admin audit trail, newest first, with the given filters. */
  async adminAudit(q: AdminAuditQuery): Promise<AdminAuditPage> {
    const conditions = [];
    if (q.action) conditions.push(eq(adminAuditLog.action, q.action));
    if (q.actor) conditions.push(ilike(adminAuditLog.actorLabel, `%${q.actor}%`));
    if (q.targetId) conditions.push(eq(adminAuditLog.targetId, q.targetId));
    if (q.after) conditions.push(gte(adminAuditLog.at, new Date(q.after)));
    if (q.before) conditions.push(lt(adminAuditLog.at, new Date(q.before)));

    // Fetch one past the page so hasMore is answered without a second count.
    const rows = await this.readDb
      .select({
        id: adminAuditLog.id,
        at: adminAuditLog.at,
        actor: adminAuditLog.actorLabel,
        action: adminAuditLog.action,
        targetType: adminAuditLog.targetType,
        targetId: adminAuditLog.targetId,
      })
      .from(adminAuditLog)
      .where(conditions.length ? and(...conditions) : undefined)
      .orderBy(sql`${adminAuditLog.at} desc`)
      .limit(q.limit + 1)
      .offset(q.offset);

    return this.page(rows, q.limit);
  }

  /** Any single workspace's audit trail, newest first, with the given filters.
   *  Scoped to the one workspace: the admin names which, and only its rows come
   *  back. The actor filter matches the stored label; action/targetId are exact. */
  async workspaceAudit(workspaceId: string, q: AdminAuditQuery): Promise<AdminAuditPage> {
    const conditions = [eq(auditLog.workspaceId, workspaceId)];
    // The workspace action column is typed to the closed AuditAction union; an
    // arbitrary filter string is compared as raw SQL so the viewer can filter
    // on any stored key (including one written before a later rename) without
    // widening the column's write-side type.
    if (q.action) conditions.push(sql`${auditLog.action} = ${q.action}`);
    if (q.actor) conditions.push(ilike(auditLog.actorLabel, `%${q.actor}%`));
    if (q.targetId) conditions.push(eq(auditLog.targetId, q.targetId));
    if (q.after) conditions.push(gte(auditLog.at, new Date(q.after)));
    if (q.before) conditions.push(lt(auditLog.at, new Date(q.before)));

    const rows = await this.readDb
      .select({
        id: auditLog.id,
        at: auditLog.at,
        actor: auditLog.actorLabel,
        action: auditLog.action,
        targetType: auditLog.targetType,
        targetId: auditLog.targetId,
      })
      .from(auditLog)
      .where(and(...conditions))
      .orderBy(sql`${auditLog.at} desc`)
      .limit(q.limit + 1)
      .offset(q.offset);

    return this.page(rows, q.limit);
  }

  /** Shared page-shaper: trims the one lookahead row and maps timestamps to ISO. */
  private page(
    rows: Array<{ id: string; at: Date; actor: string; action: string; targetType: string | null; targetId: string | null }>,
    limit: number,
  ): AdminAuditPage {
    const hasMore = rows.length > limit;
    const page = hasMore ? rows.slice(0, limit) : rows;
    return {
      hasMore,
      rows: page.map((r) => ({
        id: r.id,
        at: r.at.toISOString(),
        actor: r.actor,
        action: r.action,
        targetType: r.targetType,
        targetId: r.targetId,
      })),
    };
  }
}
