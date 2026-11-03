// #1043 — regression test for the plan-write guard. A write to workspaces.plan
// or subscriptions.planKey/interval is money; a new write site has to be
// reviewed into scripts/plan-write-allow.json before it can ship. Run by
// `node --test`.
//
// The decision core (evaluatePlanWrites) and the scanner (scanSource) are PURE,
// so the first cases drive them inline: a planted unlisted write reds, the
// pending_* pattern and a non-plan table do NOT count as writes, and a stale
// allowlist entry reds. The last two cases read the REAL tree and the committed
// allowlist, so a future unreviewed plan write (or a drifted allowlist) reds
// this test too.
import { test } from "node:test";
import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import {
  scanSource,
  evaluatePlanWrites,
  scanRepo,
  loadAllowlist,
} from "./plan-write-guard.mjs";

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "..");

// ── scanner: what is and is not a guarded plan write ─────────────────────────

test("scanSource finds a workspaces.plan update and names its function", () => {
  const src = `
    async function grantPlan(db, id) {
      await db.update(workspaces).set({ plan: "Pro", updatedAt: new Date() }).where(eq(workspaces.id, id));
    }
  `;
  const sites = scanSource(src, "apps/api/src/x.ts");
  assert.equal(sites.length, 1);
  assert.equal(sites[0].fn, "grantPlan");
  assert.equal(sites[0].key, "plan");
});

test("scanSource finds a subscriptions.planKey insert", () => {
  const src = `
    async function openCheckout(db) {
      await db.insert(subscriptions).values({ workspaceId, planKey, interval, status: "created" });
    }
  `;
  const sites = scanSource(src, "apps/api/src/x.ts");
  assert.equal(sites.length, 1);
  assert.equal(sites[0].fn, "openCheckout");
  assert.equal(sites[0].key, "planKey");
});

test("scanSource finds a patch-variable write (the #969 shape)", () => {
  const src = `
    async function updateWorkspace(db, input) {
      const patch = { updatedAt: new Date() };
      if (input.plan !== undefined) patch.plan = input.plan;
      await db.update(workspaces).set(patch).where(eq(workspaces.id, id));
    }
  `;
  const sites = scanSource(src, "apps/api/src/admin/x.ts");
  assert.equal(sites.length, 1);
  assert.equal(sites[0].fn, "updateWorkspace");
  assert.equal(sites[0].key, "plan");
});

test("scanSource does NOT flag the pending_* staging pattern (it is not an entitlement write)", () => {
  const src = `
    async function changePlan(db) {
      await db.update(subscriptions).set({ pendingPlanKey: planKey, pendingInterval: interval, updatedAt: now }).where(eq(subscriptions.id, id));
    }
  `;
  assert.deepEqual(scanSource(src, "apps/api/src/x.ts"), []);
});

test("scanSource does NOT flag planKey/interval written to a non-plan table", () => {
  const src = `
    async function recordRedemption(tx) {
      await tx.insert(couponRedemptions).values({ couponId, workspaceId, planKey, interval });
    }
  `;
  assert.deepEqual(scanSource(src, "apps/api/src/billing/coupons.service.ts"), []);
});

test("scanSource does NOT flag a SELECT projection of plan", () => {
  const src = `
    async function readPlan(db, id) {
      const [ws] = await db.select({ plan: workspaces.plan }).from(workspaces).where(eq(workspaces.id, id));
      return ws.plan;
    }
  `;
  assert.deepEqual(scanSource(src, "apps/api/src/x.ts"), []);
});

// ── decision core: allowlist semantics ───────────────────────────────────────

test("evaluatePlanWrites: a site not in the allowlist is unlisted (reds)", () => {
  const sites = [{ file: "a.ts", fn: "grantPlan", key: "plan", line: 1 }];
  const { unlisted, stale } = evaluatePlanWrites(sites, []);
  assert.equal(unlisted.length, 1);
  assert.equal(unlisted[0].fn, "grantPlan");
  assert.equal(stale.length, 0);
});

test("evaluatePlanWrites: a listed site passes, an allowlist entry matching no site is stale (reds)", () => {
  const sites = [{ file: "a.ts", fn: "grantPlan", key: "plan", line: 1 }];
  const allow = [
    { file: "a.ts", fn: "grantPlan", reason: "ok" },
    { file: "a.ts", fn: "goneAway", reason: "removed in a refactor" },
  ];
  const { unlisted, stale } = evaluatePlanWrites(sites, allow);
  assert.equal(unlisted.length, 0);
  assert.equal(stale.length, 1);
  assert.equal(stale[0].fn, "goneAway");
});

// ── the live tree ─────────────────────────────────────────────────────────────

test("every plan write site under apps/api/src and apps/worker/src is in the reviewed allowlist", () => {
  const sites = scanRepo(repoRoot);
  const allow = loadAllowlist(repoRoot);
  const { unlisted, stale } = evaluatePlanWrites(sites, allow);
  assert.deepEqual(
    unlisted.map((s) => `${s.file}::${s.fn} (${s.key} @L${s.line})`),
    [],
    "NEW unreviewed plan write(s). Add a reviewed entry to scripts/plan-write-allow.json " +
      "with WHY the write is safe (verified webhook / 409-guarded on subscribed workspaces / " +
      "pending_* staging / test seed), or change the code to a safe pattern.",
  );
  assert.deepEqual(
    stale.map((e) => `${e.file}::${e.fn}`),
    [],
    "Allowlist entr(y/ies) match no write site — the write moved or was removed. Prune scripts/plan-write-allow.json.",
  );
});

test("the live tree still contains the known plan write sites (the scanner has not gone blind)", () => {
  // If a scanner change silently stopped finding writes, the allowlist would be
  // all-stale, not all-green — but pin the count so a scanner that finds NOTHING
  // (e.g. a broken table filter) is caught here rather than passing vacuously.
  const sites = scanRepo(repoRoot);
  assert.ok(
    sites.length >= 6,
    `expected at least the 6 known plan write sites, found ${sites.length} — ` +
      `the scanner may have regressed. Sites: ${sites.map((s) => `${s.file}::${s.fn}`).join(", ")}`,
  );
  assert.ok(
    sites.some((s) => s.file.endsWith("admin-management.service.ts") && s.fn === "updateWorkspace"),
    "the #969 admin plan edit must still be discovered",
  );
  assert.ok(
    sites.some((s) => s.file.endsWith("billing.service.ts") && s.fn === "handleWebhook"),
    "the verified-webhook plan write must still be discovered",
  );
});
