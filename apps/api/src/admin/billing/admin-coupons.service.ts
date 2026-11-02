import { Inject, Injectable, NotFoundException } from "@nestjs/common";
import {
  coupons,
  couponRedemptions,
  count,
  desc,
  eq,
  workspaces,
  writeAdminAuditEntry,
  type Database,
} from "@snapurl/database";
import type {
  CouponList,
  CouponRedemptionList,
  CouponView,
  CreateCouponInput,
} from "@snapurl/contract";
import { DB } from "../../database/database.module.js";
import type { AdminActor } from "../admin-management.service.js";

/* ============================================================
   #992 — admin coupon management: create, list, pause/resume, see redemptions.

   The issue's coupon acceptance is "admins create, pause and see redemptions",
   and "a coupon respects expiry, max redemptions and plan restrictions". The
   validation half lives in the checkout CouponsService; THIS service is the
   admin catalogue: the writes an admin makes, each AUDITED through
   writeAdminAuditEntry, reached only behind AdminGuard on the controller.

   No plan is moved here and no money math is done — a coupon is only a rule the
   checkout path reads. Creating or pausing a coupon is a catalogue edit, so the
   audit entry records the actor, the coupon, and the before/after, exactly like
   the other admin management writes (#969, #989).
   ============================================================ */

/** The stored coupon row. */
type CouponRow = typeof coupons.$inferSelect;

/** Serialise a stored comma-separated plan-key restriction to a list, or null. */
function planKeysFromStored(stored: string | null): string[] | null {
  if (stored === null) return null;
  const keys = stored
    .split(",")
    .map((k) => k.trim())
    .filter((k) => k.length > 0);
  return keys.length > 0 ? keys : null;
}

/** Serialise a restriction list to the stored comma-separated, lower-cased
 *  form, or null for no restriction. */
function planKeysToStored(keys: string[] | null): string | null {
  if (keys === null || keys.length === 0) return null;
  return keys.map((k) => k.trim().toLowerCase()).join(",");
}

@Injectable()
export class AdminCouponsService {
  constructor(@Inject(DB) private readonly db: Database) {}

  /** Every coupon, newest first, each with its live redemption count. */
  async list(): Promise<CouponList> {
    const rows = await this.db
      .select({
        coupon: coupons,
        redemptions: count(couponRedemptions.id),
      })
      .from(coupons)
      .leftJoin(couponRedemptions, eq(couponRedemptions.couponId, coupons.id))
      .groupBy(coupons.id)
      .orderBy(desc(coupons.createdAt));

    return { items: rows.map((r) => toCouponView(r.coupon, Number(r.redemptions))) };
  }

  /**
   * Create a coupon. The input is already validated by the contract
   * (CreateCouponInput: percent 1..100, fixed needs a currency, repeating needs
   * durationMonths). A duplicate code (case-insensitive) is rejected by the
   * unique index and surfaces as a 409 via the Postgres-error filter. Audited.
   */
  async create(input: CreateCouponInput, actor: AdminActor): Promise<CouponView> {
    const id = await this.db.transaction(async (tx) => {
      const [row] = await tx
        .insert(coupons)
        .values({
          code: input.code.trim(),
          kind: input.kind,
          value: input.value,
          // A percent coupon stores no currency; a fixed one carries the
          // currency the contract required.
          currency: input.kind === "fixed" ? (input.currency ?? null) : null,
          duration: input.duration,
          durationMonths: input.durationMonths,
          expiresAt: input.expiresAt ? new Date(input.expiresAt) : null,
          maxRedemptions: input.maxRedemptions,
          restrictPlanKeys: planKeysToStored(input.restrictPlanKeys),
          restrictInterval: input.restrictInterval,
          createdById: actor.admin.id,
          createdByLabel: actor.admin.email,
        })
        .returning({ id: coupons.id });

      await writeAdminAuditEntry(tx, {
        actorId: actor.admin.id,
        actorLabel: actor.admin.email,
        action: "admin.coupon.create",
        targetType: "coupon",
        targetId: row!.id,
        before: null,
        after: {
          code: input.code.trim(),
          kind: input.kind,
          value: input.value,
          duration: input.duration,
        },
        requestIp: actor.ip,
      });
      return row!.id;
    });

    return this.requireView(id);
  }

  /**
   * Pause or resume a coupon. Pausing sets paused_at (no new redemptions; past
   * redemptions keep running); resuming clears it. Idempotent: pausing a paused
   * coupon re-stamps the time, resuming an active one is a no-op write. Audited
   * with the before/after paused state.
   */
  async setPaused(id: string, paused: boolean, actor: AdminActor): Promise<CouponView> {
    await this.db.transaction(async (tx) => {
      const [before] = await tx
        .select({ pausedAt: coupons.pausedAt })
        .from(coupons)
        .where(eq(coupons.id, id))
        .limit(1);
      if (!before) throw new NotFoundException("No such coupon.");

      await tx
        .update(coupons)
        .set({ pausedAt: paused ? new Date() : null, updatedAt: new Date() })
        .where(eq(coupons.id, id));

      await writeAdminAuditEntry(tx, {
        actorId: actor.admin.id,
        actorLabel: actor.admin.email,
        action: paused ? "admin.coupon.pause" : "admin.coupon.resume",
        targetType: "coupon",
        targetId: id,
        before: { paused: before.pausedAt !== null },
        after: { paused },
        requestIp: actor.ip,
      });
    });

    return this.requireView(id);
  }

  /**
   * Delete a coupon. Its redemptions cascade (the FK is ON DELETE CASCADE), so
   * the catalogue and its history go together — a deleted coupon's code is free
   * to reuse. Audited. A coupon that does not exist is a 404.
   */
  async remove(id: string, actor: AdminActor): Promise<void> {
    await this.db.transaction(async (tx) => {
      const [before] = await tx
        .select({ code: coupons.code, kind: coupons.kind, value: coupons.value })
        .from(coupons)
        .where(eq(coupons.id, id))
        .limit(1);
      if (!before) throw new NotFoundException("No such coupon.");

      await tx.delete(coupons).where(eq(coupons.id, id));

      await writeAdminAuditEntry(tx, {
        actorId: actor.admin.id,
        actorLabel: actor.admin.email,
        action: "admin.coupon.delete",
        targetType: "coupon",
        targetId: id,
        before: { code: before.code, kind: before.kind, value: before.value },
        after: null,
        requestIp: actor.ip,
      });
    });
  }

  /**
   * The redemptions of one coupon, newest first, each with its workspace. A
   * read — no audit (matching the #989 admin read convention). A coupon that
   * does not exist is a 404.
   */
  async redemptions(id: string): Promise<CouponRedemptionList> {
    const [exists] = await this.db.select({ id: coupons.id }).from(coupons).where(eq(coupons.id, id)).limit(1);
    if (!exists) throw new NotFoundException("No such coupon.");

    const rows = await this.db
      .select({
        id: couponRedemptions.id,
        workspaceId: couponRedemptions.workspaceId,
        workspaceName: workspaces.name,
        planKey: couponRedemptions.planKey,
        interval: couponRedemptions.interval,
        redeemedAt: couponRedemptions.redeemedAt,
      })
      .from(couponRedemptions)
      .leftJoin(workspaces, eq(workspaces.id, couponRedemptions.workspaceId))
      .where(eq(couponRedemptions.couponId, id))
      .orderBy(desc(couponRedemptions.redeemedAt));

    return {
      items: rows.map((r) => ({
        id: r.id,
        workspaceId: r.workspaceId,
        workspaceName: r.workspaceName ?? null,
        planKey: r.planKey,
        interval: r.interval,
        redeemedAt: r.redeemedAt.toISOString(),
      })),
    };
  }

  /** Load one coupon's view (with its live redemption count), or 404. */
  private async requireView(id: string): Promise<CouponView> {
    const [row] = await this.db.select().from(coupons).where(eq(coupons.id, id)).limit(1);
    if (!row) throw new NotFoundException("No such coupon.");
    const [tally] = await this.db
      .select({ n: count() })
      .from(couponRedemptions)
      .where(eq(couponRedemptions.couponId, id));
    return toCouponView(row, Number(tally?.n ?? 0));
  }
}

/** Shape a stored coupon row + its redemption count into the admin view. */
function toCouponView(row: CouponRow, redemptions: number): CouponView {
  return {
    id: row.id,
    code: row.code,
    kind: row.kind as CouponView["kind"],
    value: row.value,
    currency: row.currency,
    duration: row.duration as CouponView["duration"],
    durationMonths: row.durationMonths,
    expiresAt: row.expiresAt ? row.expiresAt.toISOString() : null,
    maxRedemptions: row.maxRedemptions,
    paused: row.pausedAt !== null,
    restrictPlanKeys: planKeysFromStored(row.restrictPlanKeys),
    restrictInterval: (row.restrictInterval as CouponView["restrictInterval"]) ?? null,
    redemptions,
    createdBy: row.createdByLabel,
    createdAt: row.createdAt.toISOString(),
  };
}
