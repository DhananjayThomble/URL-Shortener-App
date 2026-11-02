import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  adminAuditLog,
  createDatabase,
  desc,
  eq,
  platformSettings,
  users,
  type Database,
} from "@snapurl/database";
import { DEFAULT_KILL_SWITCHES, foldKillSwitchChanges } from "@snapurl/contract";
import type { AdminActor } from "./admin-management.service.js";
import { PlatformSettingsService } from "./platform-settings.service.js";
import { KillSwitchService } from "./kill-switch.service.js";
import type { Env } from "../config/env.js";

/* ============================================================
   #1020 — the kill-switch store + admin write path, against a real DB.

   Acceptance proven here:
     1. A write through writeKillSwitches folds a partial onto the current set,
        persists it, and the NEXT getKillSwitches reflects it (cache busted).
     2. Every change writes an admin_audit_log row carrying the before/after
        kill-switch values AND the operator's required reason.
     3. The stored row round-trips: a fresh service reads the same state.

   Red-on-broken: drop the invalidate() in writeKillSwitches and (2)'s "takes
   effect at once" read reds; drop the writeAdminAuditEntry and (2)'s audit
   assertion reds (no row); fold the wrong way and (1) reds.

   DB-gated; asserts only on the admin actor + the killSwitches key it writes.
   Cleans up the killSwitches row and its audit rows in afterAll so it does not
   leak state onto a shared DB.
   ============================================================ */

const DATABASE_URL = process.env.DATABASE_URL;
const describeDb = DATABASE_URL ? describe : describe.skip;

const env = {
  THROTTLE_LIMIT: 120,
  THROTTLE_TTL_SECONDS: 60,
  NEW_ACCOUNT_LINK_WINDOW_DAYS: 7,
} as unknown as Env;

describeDb("#1020 — kill-switch store + admin write path", () => {
  let handle: ReturnType<typeof createDatabase>;
  let db: Database;
  let settings: PlatformSettingsService;
  let killSwitches: KillSwitchService;

  const stamp = `${Date.now().toString(36)}${Math.random().toString(16).slice(2, 6)}`;
  const actorEmail = `ks-admin-${stamp}@snapurl.test`;
  let actor: AdminActor;

  beforeAll(async () => {
    handle = createDatabase({ url: DATABASE_URL!, max: 2 });
    db = handle.db;
    settings = new PlatformSettingsService(db, env);
    killSwitches = new KillSwitchService(settings, db);

    const [adminRow] = await db
      .insert(users)
      .values({ name: "KS Admin", email: actorEmail, emailVerifiedAt: new Date() })
      .returning({ id: users.id, email: users.email });
    actor = { admin: { id: adminRow!.id, name: "KS Admin", email: adminRow!.email }, ip: "203.0.113.20" };
  });

  afterAll(async () => {
    if (!db) return;
    await db.delete(adminAuditLog).where(eq(adminAuditLog.actorId, actor.admin.id));
    // Reset the singleton killSwitches row so a sibling run sees the defaults.
    await db.delete(platformSettings).where(eq(platformSettings.key, "killSwitches"));
    await db.delete(users).where(eq(users.id, actor.admin.id));
    await handle.close();
  });

  const fold = (changes: Parameters<typeof foldKillSwitchChanges>[1]) => (current: typeof DEFAULT_KILL_SWITCHES) =>
    foldKillSwitchChanges(current, changes);

  it("writes a folded partial and the next read reflects it (cache busted)", async () => {
    // Turn billing.checkout ON (it ships OFF) and lower the email caps.
    await settings.writeKillSwitches(
      fold({ "billing.checkout": { on: true }, "email.outbound": { emailCaps: { perHour: 3, perDay: 9 } } }),
      actor,
      "enable checkout for launch",
    );

    const now = await killSwitches.current();
    expect(now["billing.checkout"].on).toBe(true);
    expect(now["email.outbound"].emailCaps).toEqual({ perHour: 3, perDay: 9 });
    // Untouched switch keeps its default.
    expect(now["billing.refunds"].on).toBe(DEFAULT_KILL_SWITCHES["billing.refunds"].on);
  });

  it("records an audit row carrying before/after values AND the reason", async () => {
    await settings.writeKillSwitches(fold({ "customDomains.create": { on: true } }), actor, "open custom domains");

    const [row] = await db
      .select()
      .from(adminAuditLog)
      .where(eq(adminAuditLog.actorId, actor.admin.id))
      .orderBy(desc(adminAuditLog.at))
      .limit(1);

    expect(row!.action).toBe("admin.settings.killSwitches");
    expect(row!.targetId).toBe("killSwitches");
    const before = row!.before as { killSwitches: typeof DEFAULT_KILL_SWITCHES; reason: string };
    const after = row!.after as { killSwitches: typeof DEFAULT_KILL_SWITCHES };
    expect(before.reason).toBe("open custom domains");
    expect(before.killSwitches["customDomains.create"].on).toBe(false);
    expect(after.killSwitches["customDomains.create"].on).toBe(true);
  });

  it("round-trips: a fresh service reads the persisted state", async () => {
    const fresh = new PlatformSettingsService(db, env);
    const freshSwitch = new KillSwitchService(fresh, db);
    const state = await freshSwitch.current();
    // Reflects both writes above.
    expect(state["billing.checkout"].on).toBe(true);
    expect(state["customDomains.create"].on).toBe(true);
  });

  it("getKillSwitchesForAdmin returns values, defaults and provenance", async () => {
    const view = await settings.getKillSwitchesForAdmin();
    expect(view.values["billing.checkout"].on).toBe(true);
    expect(view.defaults).toEqual(DEFAULT_KILL_SWITCHES);
    expect(view.meta.updatedBy).toBe(actorEmail);
    expect(typeof view.meta.updatedAt).toBe("string");
  });
});
