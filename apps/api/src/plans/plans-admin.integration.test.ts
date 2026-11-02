import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { ForbiddenException } from "@nestjs/common";
import {
  adminAuditLog,
  and,
  createDatabase,
  eq,
  planVersions,
  plans,
  users,
  workspacePlanOverrides,
  workspaces,
  type Database,
} from "@snapurl/database";
import { PlansService } from "./plans.service.js";
import { PlansAdminService } from "./plans-admin.service.js";
import { EntitlementsService } from "./entitlements.service.js";
import type { AdminActor } from "../admin/admin-management.service.js";

/* ============================================================
   #970 — the plans engine's admin writes and enforcement, asserted on the rows
   each test seeds (shared DB — never on table counts).

   Oracles are the issue's acceptance lines:
     - a matrix edit creates a NEW version and leaves existing workspaces on the
       OLD one (grandfathering);
     - a per-workspace override beats the plan, and an EXPIRED override does not;
     - the single entitlement check refuses a feature not in the plan with a 403
       that names the feature, and allows one that is;
     - a limit refuses the next item at the cap and allows below it;
     - every admin write lands an admin_audit_log row with before/after.

   Red-on-broken: remove the grandfather pin in editMatrix and the "existing
   workspace keeps old entitlements" assertion fails; drop the expiry filter in
   loadActiveOverrides and the expired-override assertion fails; drop a
   writeAdminAuditEntry and its audit assertion fails.

   DB-gated: skips with no DATABASE_URL.
   ============================================================ */

const DATABASE_URL = process.env.DATABASE_URL;
const describeDb = DATABASE_URL ? describe : describe.skip;

describeDb("PlansAdminService + EntitlementsService (#970)", () => {
  let handle: ReturnType<typeof createDatabase>;
  let db: Database;
  let plansRead: PlansService;
  let admin: PlansAdminService;
  let entitlements: EntitlementsService;

  const stamp = `${Date.now().toString(36)}${Math.random().toString(16).slice(2, 6)}`;
  const planKey = `pg-${stamp}`; // a unique test plan key
  let actorId: string;
  let actor: AdminActor;

  const createdPlanIds: string[] = [];
  const createdWorkspaceIds: string[] = [];

  beforeAll(async () => {
    handle = createDatabase({ url: DATABASE_URL!, max: 1 });
    db = handle.db;
    plansRead = new PlansService(db);
    admin = new PlansAdminService(db, plansRead);
    entitlements = new EntitlementsService(plansRead);

    // A real admin user so the audit FK (actor_id -> users.id) is satisfiable.
    const [u] = await db
      .insert(users)
      .values({ name: "Admin", email: `admin-${stamp}@example.com` })
      .returning({ id: users.id });
    actorId = u!.id;
    actor = { admin: { id: actorId, name: "Admin", email: `admin-${stamp}@example.com` }, ip: "203.0.113.9" };
  });

  afterAll(async () => {
    await db.delete(adminAuditLog).where(eq(adminAuditLog.actorLabel, actor.admin.email));
    for (const id of createdWorkspaceIds) {
      await db.delete(workspacePlanOverrides).where(eq(workspacePlanOverrides.workspaceId, id));
      await db.delete(workspaces).where(eq(workspaces.id, id));
    }
    for (const id of createdPlanIds) {
      await db.delete(planVersions).where(eq(planVersions.planId, id));
      await db.delete(plans).where(eq(plans.id, id));
    }
    if (actorId) await db.delete(users).where(eq(users.id, actorId));
    await handle?.close();
  });

  async function makeWorkspace(key: string): Promise<string> {
    const id = randomUUID();
    await db.insert(workspaces).values({ id, name: "t", slug: `pg-ws-${id.slice(0, 8)}`, plan: key });
    createdWorkspaceIds.push(id);
    return id;
  }

  async function auditRows(action: string, targetId: string) {
    return db
      .select({ before: adminAuditLog.before, after: adminAuditLog.after })
      .from(adminAuditLog)
      .where(and(eq(adminAuditLog.action, action), eq(adminAuditLog.targetId, targetId)));
  }

  it("creates a plan with a first version and an audit row", async () => {
    const plan = await admin.create(
      {
        key: planKey,
        displayName: "PG Test",
        description: "",
        highlightBadge: null,
        sortOrder: 500,
        visibility: "public",
        features: { customDomains: false, forms: false },
        limits: { forms: 2, customDomains: 0 },
      },
      actor,
    );
    createdPlanIds.push(plan.id);
    expect(plan.key).toBe(planKey);
    expect(plan.version).toBe(1);
    expect(plan.features.customDomains).toBe(false);
    expect(plan.limits.forms).toBe(2);

    const rows = await auditRows("admin.plan.create", plan.id);
    expect(rows.length).toBe(1);
    expect((rows[0]!.after as { version: number }).version).toBe(1);
  });

  it("the single check refuses a feature not in the plan (403 names it) and allows one that is", async () => {
    const ws = await makeWorkspace(planKey);
    // forms is OFF in the plan -> refused, message names "forms".
    await expect(entitlements.assertFeature(ws, "forms")).rejects.toBeInstanceOf(ForbiddenException);
    await expect(entitlements.assertFeature(ws, "forms")).rejects.toThrow(/forms/i);
    expect(await entitlements.hasFeature(ws, "forms")).toBe(false);

    // Turn forms ON via a matrix edit; the same check now allows it.
    await admin.editMatrix(createdPlanIds[0]!, { features: { customDomains: false, forms: true }, limits: { forms: 2 } }, actor);
    plansRead.invalidate();
    // The pre-existing workspace was grandfathered onto v1 (forms off), so it is
    // still refused — proving the edit did not change existing workspaces.
    expect(await entitlements.hasFeature(ws, "forms")).toBe(false);

    // A NEW workspace on the plan (unpinned) picks up the current version (v2).
    const fresh = await makeWorkspace(planKey);
    expect(await entitlements.hasFeature(fresh, "forms")).toBe(true);
    await expect(entitlements.assertFeature(fresh, "forms")).resolves.toBeUndefined();
  });

  it("editing a live plan creates a new version and leaves existing workspaces on the old one", async () => {
    const planId = createdPlanIds[0]!;
    const versions = await db
      .select({ version: planVersions.version })
      .from(planVersions)
      .where(eq(planVersions.planId, planId));
    // create() made v1; the edit above made v2.
    expect(versions.map((v) => v.version).sort()).toEqual([1, 2]);

    const rows = await auditRows("admin.plan.version", planId);
    expect(rows.length).toBeGreaterThanOrEqual(1);
  });

  it("a per-workspace override beats the plan; an expired override does not", async () => {
    const ws = await makeWorkspace(planKey); // on v2 (forms on, customDomains off)
    // customDomains is OFF on the plan.
    expect(await entitlements.hasFeature(ws, "customDomains")).toBe(false);

    // Grant customDomains via an override with no expiry -> now allowed.
    await admin.setOverride(ws, { kind: "feature", name: "customDomains", value: true, expiresAt: null }, actor);
    plansRead.invalidate();
    expect(await entitlements.hasFeature(ws, "customDomains")).toBe(true);

    // Replace it with an already-expired override -> ignored, plan value stands.
    await admin.setOverride(
      ws,
      { kind: "feature", name: "customDomains", value: true, expiresAt: new Date(Date.now() - 60_000).toISOString() },
      actor,
    );
    plansRead.invalidate();
    expect(await entitlements.hasFeature(ws, "customDomains")).toBe(false);

    const rows = await auditRows("admin.workspace.override_set", ws);
    expect(rows.length).toBe(2);
  });

  it("a limit override raises the cap; the check refuses the next item at the cap", async () => {
    const ws = await makeWorkspace(planKey); // forms limit = 2 on v2
    // At 2 forms, the next one is refused (cap reached).
    await expect(entitlements.assertWithinLimit(ws, "forms", 2)).rejects.toThrow(/forms/i);
    // Below the cap, allowed.
    await expect(entitlements.assertWithinLimit(ws, "forms", 1)).resolves.toBeUndefined();

    // Raise the forms limit to 10 for this workspace only.
    await admin.setOverride(ws, { kind: "limit", name: "forms", value: 10, expiresAt: null }, actor);
    plansRead.invalidate();
    expect(await entitlements.limitFor(ws, "forms")).toBe(10);
    await expect(entitlements.assertWithinLimit(ws, "forms", 2)).resolves.toBeUndefined();
  });

  it("removing an override restores the plan value and audits the removal", async () => {
    const ws = await makeWorkspace(planKey);
    const ov = await admin.setOverride(ws, { kind: "limit", name: "forms", value: 99, expiresAt: null }, actor);
    plansRead.invalidate();
    expect(await entitlements.limitFor(ws, "forms")).toBe(99);

    await admin.removeOverride(ws, ov.id, actor);
    plansRead.invalidate();
    expect(await entitlements.limitFor(ws, "forms")).toBe(2); // back to the v2 plan value

    const rows = await auditRows("admin.workspace.override_remove", ws);
    expect(rows.length).toBe(1);
  });

  it("migrating a workspace pins it to a chosen version (grandfather control)", async () => {
    const ws = await makeWorkspace(planKey); // unpinned -> current (v2, forms on)
    expect(await entitlements.hasFeature(ws, "forms")).toBe(true);

    // Pin to v1 (forms off).
    await admin.migrateWorkspaceVersion(ws, { version: 1 }, actor);
    plansRead.invalidate();
    expect(await entitlements.hasFeature(ws, "forms")).toBe(false);

    // Unpin -> back to current (v2, forms on).
    await admin.migrateWorkspaceVersion(ws, { version: null }, actor);
    plansRead.invalidate();
    expect(await entitlements.hasFeature(ws, "forms")).toBe(true);

    const rows = await auditRows("admin.workspace.migrate_version", ws);
    expect(rows.length).toBe(2);
  });
});
