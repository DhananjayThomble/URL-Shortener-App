import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  coupons,
  couponRedemptions,
  createDatabase,
  eq,
  users,
  workspaces,
  type Database,
} from "@snapurl/database";
import { CouponsService, CouponNotApplicableError } from "./coupons.service.js";

/* ============================================================
   #992 — CouponsService against the real DB.

   Oracles are the issue's coupon acceptance lines, NOT the implementation:
     - "a coupon respects expiry, max redemptions and plan restrictions": a
       paused / expired / plan-restricted / interval-restricted / cap-reached
       coupon is rejected with the matching reason; a clean one validates.
     - one redemption per workspace, exactly: recordRedemption is atomic on the
       (coupon, workspace) unique index — two concurrent redemptions of the same
       coupon by the same workspace cannot both land (the loser 409s), and the
       cap is a count of real rows, so a race cannot exceed max_redemptions.

   Red-on-broken: drop the unique index (or swap the insert for an upsert) and
   the race/double-redeem assertions red (two rows land); skip a rejection
   branch and that reason's test reds.

   DB-gated: skips with no DATABASE_URL. Every row is this test's own (unique
   per-run stamp). Pools/handles closed in afterAll.
   ============================================================ */

const DATABASE_URL = process.env.DATABASE_URL;
const describeDb = DATABASE_URL ? describe : describe.skip;

describeDb("#992 — CouponsService: validation + one-redemption-per-workspace", () => {
  let handle: ReturnType<typeof createDatabase>;
  let db: Database;
  let service: CouponsService;

  const stamp = `${Date.now().toString(36)}${Math.random().toString(16).slice(2, 6)}`;
  const couponIds: string[] = [];
  const workspaceIds: string[] = [];
  const userIds: string[] = [];

  async function seedWorkspace(tag: string): Promise<string> {
    const email = `coupon-${tag}-${stamp}@example.com`;
    const [u] = await db.insert(users).values({ name: `C ${tag}`, email, emailVerifiedAt: new Date() }).returning({ id: users.id });
    userIds.push(u!.id);
    const [ws] = await db.insert(workspaces).values({ name: `WS ${tag}`, slug: `coupon-${tag}-${stamp}` }).returning({ id: workspaces.id });
    workspaceIds.push(ws!.id);
    return ws!.id;
  }

  async function seedCoupon(tag: string, overrides: Partial<typeof coupons.$inferInsert> = {}): Promise<string> {
    const [row] = await db
      .insert(coupons)
      .values({
        code: `C-${tag}-${stamp}`,
        kind: "percent",
        value: 20,
        duration: "once",
        providerOfferId: `offer_${tag}_${stamp}`,
        ...overrides,
      })
      .returning({ id: coupons.id });
    couponIds.push(row!.id);
    return row!.id;
  }

  beforeAll(() => {
    handle = createDatabase({ url: DATABASE_URL!, max: 4 });
    db = handle.db;
    service = new CouponsService(db);
  });

  afterAll(async () => {
    if (!db) return;
    // Clean up this run's rows (redemptions cascade when a coupon is deleted).
    for (const id of couponIds) await db.delete(coupons).where(eq(coupons.id, id));
    for (const id of workspaceIds) await db.delete(workspaces).where(eq(workspaces.id, id));
    for (const id of userIds) await db.delete(users).where(eq(users.id, id));
    await handle.close();
  });

  it("validates a clean coupon and returns its provider offer + discount preview", async () => {
    const couponId = await seedCoupon("ok");
    const resolved = await service.validate(`C-ok-${stamp}`, "pro", "monthly", 10000);
    expect(resolved.couponId).toBe(couponId);
    expect(resolved.providerOfferId).toBe(`offer_ok_${stamp}`);
    // 20% of 10000 = 2000.
    expect(resolved.discountMinor).toBe(2000);
  });

  it("matches the code case-insensitively", async () => {
    await seedCoupon("case");
    const resolved = await service.validate(`c-CASE-${stamp}`.toUpperCase(), "pro", "monthly", 5000);
    expect(resolved.discountMinor).toBe(1000);
  });

  it("rejects an unknown code as not_found (400)", async () => {
    await expect(service.validate(`does-not-exist-${stamp}`, "pro", "monthly", 1000)).rejects.toMatchObject({
      reason: "not_found",
    });
  });

  it("rejects a paused coupon", async () => {
    await seedCoupon("paused", { pausedAt: new Date() });
    await expect(service.validate(`C-paused-${stamp}`, "pro", "monthly", 1000)).rejects.toMatchObject({
      reason: "paused",
    });
  });

  it("rejects an expired coupon", async () => {
    await seedCoupon("exp", { expiresAt: new Date(Date.now() - 1000) });
    await expect(service.validate(`C-exp-${stamp}`, "pro", "monthly", 1000)).rejects.toMatchObject({
      reason: "expired",
    });
  });

  it("rejects a plan-restricted coupon for a plan outside the list", async () => {
    await seedCoupon("plan", { restrictPlanKeys: "team" });
    await expect(service.validate(`C-plan-${stamp}`, "pro", "monthly", 1000)).rejects.toMatchObject({
      reason: "plan_not_allowed",
    });
    // and allows the listed plan
    const ok = await service.validate(`C-plan-${stamp}`, "team", "monthly", 1000);
    expect(ok.couponId).toBeTruthy();
  });

  it("rejects an interval-restricted coupon for the wrong interval", async () => {
    await seedCoupon("int", { restrictInterval: "yearly" });
    await expect(service.validate(`C-int-${stamp}`, "pro", "monthly", 1000)).rejects.toMatchObject({
      reason: "interval_not_allowed",
    });
  });

  it("respects max redemptions: once the cap is reached, validate rejects", async () => {
    const couponId = await seedCoupon("cap", { maxRedemptions: 1 });
    const wsA = await seedWorkspace("capA");
    const wsB = await seedWorkspace("capB");

    // First workspace redeems — fills the single slot.
    await service.recordRedemption(couponId, wsA, "pro", "monthly");

    // A second workspace now sees the cap reached.
    await expect(service.validate(`C-cap-${stamp}`, "pro", "monthly", 1000)).rejects.toMatchObject({
      reason: "max_redemptions_reached",
    });

    // Belt and braces: even if validation were bypassed, the row count is 1.
    const rows = await db.select().from(couponRedemptions).where(eq(couponRedemptions.couponId, couponId));
    expect(rows).toHaveLength(1);
    void wsB;
  });

  it("records exactly one redemption per workspace — a second attempt 409s", async () => {
    const couponId = await seedCoupon("once");
    const ws = await seedWorkspace("once");

    await service.recordRedemption(couponId, ws, "pro", "monthly");
    // Same (coupon, workspace) again: the unique index rejects it.
    await expect(service.recordRedemption(couponId, ws, "pro", "monthly")).rejects.toMatchObject({
      status: 409,
    });

    const rows = await db.select().from(couponRedemptions).where(eq(couponRedemptions.couponId, couponId));
    expect(rows).toHaveLength(1);
  });

  it("a RACE of concurrent redemptions by the same workspace lands exactly one", async () => {
    const couponId = await seedCoupon("race");
    const ws = await seedWorkspace("race");

    // Fire several concurrent redemptions; the unique index is the arbiter, so
    // exactly one INSERT wins and the rest raise unique violations (mapped to
    // 409). This is the real concurrency guard, not a read-then-write.
    const attempts = await Promise.allSettled(
      Array.from({ length: 5 }, () => service.recordRedemption(couponId, ws, "pro", "monthly")),
    );
    const fulfilled = attempts.filter((a) => a.status === "fulfilled");
    const rejected = attempts.filter((a) => a.status === "rejected");
    expect(fulfilled).toHaveLength(1);
    expect(rejected).toHaveLength(4);

    const rows = await db.select().from(couponRedemptions).where(eq(couponRedemptions.couponId, couponId));
    expect(rows).toHaveLength(1);
  });

  it("the CouponNotApplicableError carries the code and a 400", async () => {
    try {
      await service.validate(`nope-${stamp}`, "pro", "monthly", 1000);
      expect.unreachable("should have thrown");
    } catch (err) {
      expect(err).toBeInstanceOf(CouponNotApplicableError);
      expect((err as CouponNotApplicableError).getStatus()).toBe(400);
    }
  });

  /* ============================================================
     #1024 — the cross-workspace cap holds under concurrency.

     Oracle (the issue's acceptance): N parallel redemptions by DIFFERENT
     workspaces against a cap-K coupon let EXACTLY K land, and the extra
     concurrent redemptions are refused with the 400 "reached its redemption
     limit". This is the bug: with a read-then-write cap, two different
     workspaces could both read count < max and both insert, so coupon_redemptions
     exceeded maxRedemptions.

     Red-on-main: against origin/main (validate() SELECT-counts, recordRedemption
     bare-INSERTs, no atomic guard) more than K redemptions land and this test
     reds. The fix makes recordRedemption bump an authoritative redeemed_count
     with a conditional UPDATE in the same transaction, so exactly K win.
     ============================================================ */
  it("enforces the cap under concurrency: N parallel redemptions across workspaces, exactly K land (#1024)", async () => {
    const CAP = 3;
    const N = 12;
    const couponId = await seedCoupon("race1024", { maxRedemptions: CAP });

    // N DIFFERENT workspaces, so the (coupon, workspace) unique index never
    // fires — the only thing that may stop a redemption is the cross-workspace
    // cap. That is exactly the gap the issue reports.
    const wsIds = await Promise.all(
      Array.from({ length: N }, (_, i) => seedWorkspace(`race1024-${i}`)),
    );

    const results = await Promise.allSettled(
      wsIds.map((ws) => service.recordRedemption(couponId, ws, "pro", "monthly")),
    );

    const fulfilled = results.filter((r) => r.status === "fulfilled");
    const rejected = results.filter(
      (r): r is PromiseRejectedResult => r.status === "rejected",
    );

    // Exactly CAP succeed; the rest are refused.
    expect(fulfilled).toHaveLength(CAP);
    expect(rejected).toHaveLength(N - CAP);

    // The refusals are the cap, surfaced as the 400 "reached its redemption
    // limit" — not a crash, a 409, or anything else.
    for (const r of rejected) {
      expect(r.reason).toBeInstanceOf(CouponNotApplicableError);
      expect((r.reason as CouponNotApplicableError).reason).toBe("max_redemptions_reached");
      expect((r.reason as CouponNotApplicableError).getStatus()).toBe(400);
    }

    // The source of truth: real redemption rows never exceed the cap.
    const rows = await db
      .select()
      .from(couponRedemptions)
      .where(eq(couponRedemptions.couponId, couponId));
    expect(rows).toHaveLength(CAP);

    // A fresh workspace arriving after the race still sees the cap full.
    const late = await seedWorkspace("race1024-late");
    await expect(service.recordRedemption(couponId, late, "pro", "monthly")).rejects.toMatchObject({
      reason: "max_redemptions_reached",
    });
  });

  it("an unlimited coupon (no cap) still records every concurrent redemption (#1024)", async () => {
    const N = 8;
    const couponId = await seedCoupon("unl1024", { maxRedemptions: null });
    const wsIds = await Promise.all(
      Array.from({ length: N }, (_, i) => seedWorkspace(`unl1024-${i}`)),
    );

    const results = await Promise.allSettled(
      wsIds.map((ws) => service.recordRedemption(couponId, ws, "pro", "monthly")),
    );
    expect(results.every((r) => r.status === "fulfilled")).toBe(true);

    const rows = await db
      .select()
      .from(couponRedemptions)
      .where(eq(couponRedemptions.couponId, couponId));
    expect(rows).toHaveLength(N);
  });

  it("a same-workspace double redemption is still refused with a 409, not a cap slot (#1024)", async () => {
    // With the cap now atomic, the same-workspace guard must still hold AND must
    // not leak a cap slot: the 409'd retry rolls back the counter bump.
    const couponId = await seedCoupon("dbl1024", { maxRedemptions: 2 });
    const ws = await seedWorkspace("dbl1024");

    await service.recordRedemption(couponId, ws, "pro", "monthly");
    await expect(service.recordRedemption(couponId, ws, "pro", "monthly")).rejects.toMatchObject({
      status: 409,
    });

    // One row, and the second (coupon, workspace) slot is still open for a
    // DIFFERENT workspace — the refused retry did not consume it.
    const rows = await db
      .select()
      .from(couponRedemptions)
      .where(eq(couponRedemptions.couponId, couponId));
    expect(rows).toHaveLength(1);

    const ws2 = await seedWorkspace("dbl1024-b");
    await service.recordRedemption(couponId, ws2, "pro", "monthly");
    const rows2 = await db
      .select()
      .from(couponRedemptions)
      .where(eq(couponRedemptions.couponId, couponId));
    expect(rows2).toHaveLength(2);
  });
});
