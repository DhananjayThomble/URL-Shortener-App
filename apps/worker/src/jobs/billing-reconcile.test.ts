import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import {
  createDatabase,
  eq,
  memberships,
  subscriptions,
  users,
  workspaces,
  type Database,
} from "@snapurl/database";
import { reconcileBilling, type ProviderStatusSource } from "./billing-reconcile.js";

/* ============================================================
   #989 — the daily reconciliation job flags a local-vs-provider mismatch.

   Oracle is the issue's acceptance line: "Reconciliation flags a seeded
   mismatch (test)." The provider read is injected (ProviderStatusSource), so no
   network: the test seeds a local subscription in one status, has the fake
   provider report a DIFFERENT status, and asserts the pass returns that row as
   a mismatch and calls the alert sink. It also asserts a matching row is NOT
   flagged, and that a provider that does not know a subscription (null) is
   itself a mismatch.

   Red-on-broken: make reconcileBilling compare nothing (always treat as
   matching) and the mismatch assertion reds.

   DB-gated: skips with no DATABASE_URL; CI applies the migrations first. Every
   assertion is on rows THIS test seeded (per-run stamp).
   ============================================================ */

const DATABASE_URL = process.env.DATABASE_URL;
const describeDb = DATABASE_URL ? describe : describe.skip;

describeDb("reconcileBilling flags local-vs-provider mismatches (#989)", () => {
  let handle: ReturnType<typeof createDatabase>;
  let db: Database;

  const stamp = `${Date.now().toString(36)}${Math.random().toString(16).slice(2, 6)}`;
  const workspaceIds: string[] = [];
  const userIds: string[] = [];

  async function seedSub(tag: string, localStatus: string): Promise<{ workspaceId: string; subId: string }> {
    const email = `recon-${tag}-${stamp}@example.com`;
    const [u] = await db.insert(users).values({ name: `R ${tag}`, email, emailVerifiedAt: new Date() }).returning({ id: users.id });
    userIds.push(u!.id);
    const [ws] = await db.insert(workspaces).values({ name: `WS ${tag}`, slug: `recon-${tag}-${stamp}` }).returning({ id: workspaces.id });
    workspaceIds.push(ws!.id);
    await db.insert(memberships).values({ workspaceId: ws!.id, userId: u!.id, email, role: "owner", status: "active" });
    const subId = `sub_recon_${stamp}_${tag}`;
    await db.insert(subscriptions).values({
      workspaceId: ws!.id,
      planKey: "pro",
      interval: "monthly",
      provider: "razorpay",
      providerSubscriptionId: subId,
      status: localStatus,
      updatedAt: new Date(),
    });
    return { workspaceId: ws!.id, subId };
  }

  beforeAll(async () => {
    handle = createDatabase({ url: DATABASE_URL!, max: 4 });
    db = handle.db;
  });

  afterAll(async () => {
    if (!db) return;
    for (const id of workspaceIds) await db.delete(workspaces).where(eq(workspaces.id, id));
    for (const id of userIds) await db.delete(users).where(eq(users.id, id));
    await handle.close();
  });

  it("flags a subscription whose local status disagrees with the provider", async () => {
    // Local says active; the provider (fake) says cancelled — a missed
    // subscription.cancelled webhook, the exact drift this job catches.
    const { workspaceId, subId } = await seedSub("drift", "active");
    const matching = await seedSub("ok", "active");

    const providerStatus: ProviderStatusSource = vi.fn(async (id: string) => {
      if (id === subId) return "cancelled"; // the drifted one
      return "active"; // everyone else matches
    });
    const alert = vi.fn();

    const result = await reconcileBilling(db, {
      providerStatus,
      alert,
      // Scope to the two subs this test seeded, so sibling rows in the shared
      // DB do not add noise to the counts.
      statuses: ["active"],
    });

    // The drifted row is flagged...
    const mine = result.mismatches.find((m) => m.subscriptionId !== matching.subId && m.providerSubscriptionId === subId);
    expect(mine).toBeDefined();
    expect(mine!.workspaceId).toBe(workspaceId);
    expect(mine!.localStatus).toBe("active");
    expect(mine!.providerStatus).toBe("cancelled");
    expect(alert).toHaveBeenCalledWith(expect.objectContaining({ providerSubscriptionId: subId }));

    // ...and the matching row is NOT among the mismatches.
    expect(result.mismatches.some((m) => m.providerSubscriptionId === matching.subId)).toBe(false);
  });

  it("flags a local row the provider does not know (provider status null)", async () => {
    const { subId } = await seedSub("ghost", "active");
    const providerStatus: ProviderStatusSource = async (id) => (id === subId ? null : "active");

    const result = await reconcileBilling(db, { providerStatus, statuses: ["active"] });
    const ghost = result.mismatches.find((m) => m.providerSubscriptionId === subId);
    expect(ghost).toBeDefined();
    expect(ghost!.providerStatus).toBeNull();
  });

  it("does not flag when local and provider agree", async () => {
    const { subId } = await seedSub("agree", "halted");
    const providerStatus: ProviderStatusSource = async () => "halted";

    const result = await reconcileBilling(db, { providerStatus, statuses: ["halted"] });
    expect(result.mismatches.some((m) => m.providerSubscriptionId === subId)).toBe(false);
    expect(result.checked).toBeGreaterThanOrEqual(1);
  });
});
