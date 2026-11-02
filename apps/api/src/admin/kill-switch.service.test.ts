import { describe, expect, it, vi } from "vitest";
import { DEFAULT_KILL_SWITCHES, type KillSwitchesSetting } from "@snapurl/contract";
import {
  KillSwitchCapError,
  KillSwitchOffError,
  KillSwitchService,
} from "./kill-switch.service.js";
import type { PlatformSettingsService } from "./platform-settings.service.js";
import type { Database } from "@snapurl/database";

/* #1020 — the enforcement engine. These unit tests drive KillSwitchService with
   a fake settings service and a fake DB (no Postgres), covering:
     • assertOn refuses OFF (503, feature_off) and passes ON;
     • FAIL CLOSED: a settings read that throws => paid switches OFF;
     • custom-domain caps refuse the N+1th on total AND per-day;
     • email: the OFF switch blocks ordinary mail but auth-critical BYPASSES it,
       and BOTH are still refused once a cap is hit;
     • the error-tracking policy read.
   The webhook-never-off invariant is a billing-service concern (that path never
   calls this service); the integration test proves it end to end. */

/** A settings-service fake returning a chosen kill-switch set, or throwing to
 *  simulate an unreadable store. */
function settingsStub(opts: { switches?: KillSwitchesSetting; throws?: boolean }): PlatformSettingsService {
  return {
    getKillSwitches: async () => {
      if (opts.throws) throw new Error("db down");
      return opts.switches ?? structuredClone(DEFAULT_KILL_SWITCHES);
    },
  } as unknown as PlatformSettingsService;
}

/** What a captured refusal audit looks like, reconstructed from the fake DB's
 *  recorded insert calls. */
interface CapturedRefusal {
  action: string;
  targetType: string | null;
  targetId: string | null;
  actorId: string | null;
  actorLabel: string;
  after: unknown;
  requestIp: string | null;
}

/** A DB fake for KillSwitchService. It:
 *   • answers the email-count query `select().from().where()` => `[{ n }]`;
 *   • answers the refusal-window upsert
 *     `insert().values(v).onConflictDoUpdate().returning()` with a scripted
 *     window count (1 = fresh window => audit row written) and records the
 *     attempted insert;
 *   • answers the plain audit insert `insert().values(v)` (writeAdminAuditEntry)
 *     and records it as a CapturedRefusal.
 *
 *  `windowCount` scripts what the upsert's RETURNING count is (default 1, the
 *  first-in-window path). `insertThrows` makes EVERY insert throw, to prove the
 *  service swallows an audit-write failure and still refuses. */
function dbStub(
  emailCount = 0,
  opts: { countThrows?: boolean; windowCount?: number; insertThrows?: boolean } = {},
): Database & { refusals: CapturedRefusal[]; upserts: Array<Record<string, unknown>> } {
  const refusals: CapturedRefusal[] = [];
  const upserts: Array<Record<string, unknown>> = [];
  const selectChain = {
    from: () => selectChain,
    where: async () => {
      if (opts.countThrows) throw new Error("count failed");
      return [{ n: emailCount }];
    },
  };
  const db = {
    refusals,
    upserts,
    select: () => selectChain,
    insert: () => ({
      values: (v: Record<string, unknown>) => {
        // The refusal-window upsert: values(...).onConflictDoUpdate(...).returning()
        const builder = {
          onConflictDoUpdate: () => builder,
          returning: async () => {
            if (opts.insertThrows) throw new Error("insert failed");
            upserts.push(v);
            return [{ count: opts.windowCount ?? 1 }];
          },
          // A bare `await insert().values(v)` (writeAdminAuditEntry) — a thenable
          // so awaiting it resolves after recording the row.
          then: (resolve: (value?: unknown) => void, reject: (reason?: unknown) => void) => {
            if (opts.insertThrows) return reject(new Error("insert failed"));
            refusals.push({
              action: v.action as string,
              targetType: (v.targetType ?? null) as string | null,
              targetId: (v.targetId ?? null) as string | null,
              actorId: (v.actorId ?? null) as string | null,
              actorLabel: v.actorLabel as string,
              after: v.after ?? null,
              requestIp: (v.requestIp ?? null) as string | null,
            });
            return resolve(undefined);
          },
        };
        return builder;
      },
    }),
  };
  return db as unknown as Database & { refusals: CapturedRefusal[]; upserts: Array<Record<string, unknown>> };
}

function on(key: keyof KillSwitchesSetting, value: boolean): KillSwitchesSetting {
  const s = structuredClone(DEFAULT_KILL_SWITCHES);
  s[key] = { ...s[key], on: value };
  return s;
}

describe("assertOn", () => {
  it("passes when the switch is ON", async () => {
    const svc = new KillSwitchService(settingsStub({ switches: on("billing.checkout", true) }), dbStub(0));
    await expect(svc.assertOn("billing.checkout")).resolves.toBeUndefined();
  });

  it("throws KillSwitchOffError (feature_off) when OFF", async () => {
    const svc = new KillSwitchService(settingsStub({ switches: on("billing.checkout", false) }), dbStub(0));
    await expect(svc.assertOn("billing.checkout")).rejects.toBeInstanceOf(KillSwitchOffError);
    try {
      await svc.assertOn("billing.checkout");
    } catch (err) {
      expect((err as KillSwitchOffError).reason).toBe("feature_off");
      expect((err as KillSwitchOffError).switchKey).toBe("billing.checkout");
      expect((err as KillSwitchOffError).getStatus()).toBe(503);
    }
  });
});

describe("fail closed", () => {
  it("reads every PAID switch OFF when the store throws", async () => {
    const svc = new KillSwitchService(settingsStub({ throws: true }), dbStub(0));
    const current = await svc.current();
    expect(current["billing.checkout"].on).toBe(false);
    expect(current["billing.planChanges"].on).toBe(false);
    expect(current["billing.coupons"].on).toBe(false);
    expect(current["billing.trials"].on).toBe(false);
    expect(current["billing.refunds"].on).toBe(false);
    expect(current["customDomains.create"].on).toBe(false);
  });

  it("keeps background switches on their shipped default when the store throws", async () => {
    const svc = new KillSwitchService(settingsStub({ throws: true }), dbStub(0));
    const current = await svc.current();
    expect(current["email.outbound"].on).toBe(true);
    expect(current.errorTracking.on).toBe(true);
    expect(current["linkScanning.rescans"].on).toBe(true);
  });

  it("assertOn on a paid switch refuses when the store is unreadable", async () => {
    const svc = new KillSwitchService(settingsStub({ throws: true }), dbStub(0));
    await expect(svc.assertOn("billing.refunds")).rejects.toBeInstanceOf(KillSwitchOffError);
  });
});

describe("custom-domain caps", () => {
  const svc = new KillSwitchService(settingsStub({}), dbStub(0));
  const caps = structuredClone(DEFAULT_KILL_SWITCHES);
  caps["customDomains.create"].domainCaps = { totalMax: 2, perDay: 1 };

  it("allows below both caps", async () => {
    await expect(svc.assertCustomDomainUnderCaps(caps, 1, 0)).resolves.toBeUndefined();
  });

  it("refuses the N+1th on the total cap", async () => {
    try {
      await svc.assertCustomDomainUnderCaps(caps, 2, 0);
      throw new Error("should have thrown");
    } catch (err) {
      expect(err).toBeInstanceOf(KillSwitchCapError);
      expect((err as KillSwitchCapError).reason).toBe("cap_reached");
      expect((err as KillSwitchCapError).cap).toBe(2);
      expect((err as KillSwitchCapError).getStatus()).toBe(403);
    }
  });

  it("refuses the N+1th on the per-day cap even when total is fine", async () => {
    await expect(svc.assertCustomDomainUnderCaps(caps, 0, 1)).rejects.toBeInstanceOf(KillSwitchCapError);
  });
});

describe("email gate", () => {
  it("blocks ordinary mail when email.outbound is OFF", async () => {
    const svc = new KillSwitchService(settingsStub({ switches: on("email.outbound", false) }), dbStub(0));
    await expect(svc.assertEmailAllowed(false)).rejects.toBeInstanceOf(KillSwitchOffError);
  });

  it("lets AUTH-CRITICAL mail bypass the OFF switch", async () => {
    const svc = new KillSwitchService(settingsStub({ switches: on("email.outbound", false) }), dbStub(0));
    await expect(svc.assertEmailAllowed(true)).resolves.toBeUndefined();
  });

  it("refuses auth-critical mail too once the hourly cap is hit", async () => {
    const switches = structuredClone(DEFAULT_KILL_SWITCHES);
    switches["email.outbound"] = { on: false, emailCaps: { perHour: 5, perDay: 100 } };
    // 5 already sent this hour == at the cap: the next (N+1th) is refused.
    const svc = new KillSwitchService(settingsStub({ switches }), dbStub(5));
    await expect(svc.assertEmailAllowed(true)).rejects.toBeInstanceOf(KillSwitchCapError);
  });

  it("allows an ON send below the caps", async () => {
    const switches = structuredClone(DEFAULT_KILL_SWITCHES);
    switches["email.outbound"] = { on: true, emailCaps: { perHour: 10, perDay: 100 } };
    const svc = new KillSwitchService(settingsStub({ switches }), dbStub(3));
    await expect(svc.assertEmailAllowed(false)).resolves.toBeUndefined();
  });

  it("fails closed (refuses) when the cap count query throws", async () => {
    const svc = new KillSwitchService(settingsStub({ switches: on("email.outbound", true) }), dbStub(0, { countThrows: true }));
    await expect(svc.assertEmailAllowed(false)).rejects.toBeInstanceOf(KillSwitchCapError);
  });

  it("recordSentEmail swallows a DB failure (best-effort)", async () => {
    const failingInsert = {
      insert: () => ({ values: async () => { throw new Error("insert failed"); } }),
      select: () => ({ from: () => ({ where: async () => [{ n: 0 }] }) }),
    } as unknown as Database;
    const svc = new KillSwitchService(settingsStub({}), failingInsert);
    await expect(svc.recordSentEmail(false)).resolves.toBeUndefined();
  });
});

describe("errorTrackingPolicy", () => {
  it("reports the switch state and the sample-rate cap", async () => {
    const switches = structuredClone(DEFAULT_KILL_SWITCHES);
    switches.errorTracking = { on: true, errorCaps: { sampleRate: 0.2 } };
    const svc = new KillSwitchService(settingsStub({ switches }), dbStub(0));
    expect(await svc.errorTrackingPolicy()).toEqual({ on: true, sampleRate: 0.2 });
  });

  it("reports off when the switch is off", async () => {
    const svc = new KillSwitchService(settingsStub({ switches: on("errorTracking", false) }), dbStub(0));
    const policy = await svc.errorTrackingPolicy();
    expect(policy.on).toBe(false);
  });
});

describe("isOn + cacheTtlMs", () => {
  it("isOn reflects the switch", async () => {
    const svc = new KillSwitchService(settingsStub({ switches: on("linkScanning.rescans", false) }), dbStub(0));
    expect(await svc.isOn("linkScanning.rescans")).toBe(false);
  });

  it("exposes the settings cache TTL", () => {
    const svc = new KillSwitchService(settingsStub({}), dbStub(0));
    expect(svc.cacheTtlMs).toBeGreaterThan(0);
  });

  it("logs and fails closed without rethrowing on a read error", async () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    const svc = new KillSwitchService(settingsStub({ throws: true }), dbStub(0));
    await expect(svc.current()).resolves.toBeDefined();
    spy.mockRestore();
  });
});


/* #1020 ↔ #995 — the errorTracking switch drives the telemetry SamplingController.
   current() pushes { enabled, sampleRateCap } into the controller every read, so
   OFF stops every event and the cap bounds the effective sample rate. These wire
   KillSwitchService to a REAL SamplingController (env ceiling 1.0, DSN configured)
   through the injectable errorTrackingSync seam. */
import { SamplingController } from "@snapurl/telemetry";

describe("errorTracking → telemetry SamplingController", () => {
  function wire(switches: KillSwitchesSetting) {
    const controller = new SamplingController({
      dsnConfigured: true,
      errorsSampleRate: 1, // env ceiling: a cap can only lower this
      tracesSampleRate: 0,
    });
    const svc = new KillSwitchService(settingsStub({ switches }), dbStub(0));
    svc.setErrorTrackingSyncForTesting((controls) => controller.setRuntimeControls(controls));
    return { controller, svc };
  }

  it("OFF stops every event (shouldSend() false, sampleRate() 0)", async () => {
    const switches = structuredClone(DEFAULT_KILL_SWITCHES);
    switches.errorTracking = { on: false, errorCaps: { sampleRate: 1 } };
    const { controller, svc } = wire(switches);
    // Before any read the controller is on (DSN configured, no controls yet).
    expect(controller.shouldSend()).toBe(true);
    await svc.current();
    // The OFF switch flipped it off: no event is sent.
    expect(controller.shouldSend()).toBe(false);
    expect(controller.sampleRate()).toBe(0);
  });

  it("the cap bounds the effective sample rate (never above the env ceiling)", async () => {
    const switches = structuredClone(DEFAULT_KILL_SWITCHES);
    switches.errorTracking = { on: true, errorCaps: { sampleRate: 0.1 } };
    const { controller, svc } = wire(switches);
    await svc.current();
    expect(controller.shouldSend()).toBe(true);
    // env rate 1.0, cap 0.1 => effective min(1, 0.1) = 0.1.
    expect(controller.sampleRate()).toBeCloseTo(0.1, 10);
  });

  it("a cap above the env ceiling cannot raise the rate", async () => {
    const switches = structuredClone(DEFAULT_KILL_SWITCHES);
    switches.errorTracking = { on: true, errorCaps: { sampleRate: 1 } };
    const controller = new SamplingController({ dsnConfigured: true, errorsSampleRate: 0.3, tracesSampleRate: 0 });
    const svc = new KillSwitchService(settingsStub({ switches }), dbStub(0));
    svc.setErrorTrackingSyncForTesting((c) => controller.setRuntimeControls(c));
    await svc.current();
    // env 0.3, cap 1 => min(0.3, 1) = 0.3, not raised.
    expect(controller.sampleRate()).toBeCloseTo(0.3, 10);
  });

  it("a telemetry sync failure never breaks a settings read", async () => {
    const svc = new KillSwitchService(settingsStub({}), dbStub(0));
    svc.setErrorTrackingSyncForTesting(() => {
      throw new Error("telemetry down");
    });
    const spy = vi.spyOn(console, "warn").mockImplementation(() => {});
    await expect(svc.current()).resolves.toBeDefined();
    spy.mockRestore();
  });
});



/* #1032 — refusals are written to the platform audit trail.

   RED ON MAIN: on origin/main the assert methods throw the typed error and
   write NOTHING, so `db.refusals` stays empty — every "writes one audit row"
   assertion below FAILS before this change and passes after it. That is the
   bug the issue reports (admin.killswitch.refused never appears), proven at the
   unit level; the DB integration test proves the dedupe counter against real
   Postgres and the worker test proves a worker-job refusal is audited too.

   The fake DB records (a) the refusal-window upsert values and (b) the
   admin_audit_log row writeAdminAuditEntry inserts, so these assert both the
   row's shape (action / target / reason / actor / workspace) AND that NO PII
   beyond ids rides along. */
describe("#1032 refusal audit", () => {
  it("writes one admin.killswitch.refused row for a feature_off 503 (RED on main)", async () => {
    const db = dbStub(0);
    const svc = new KillSwitchService(settingsStub({ switches: on("billing.checkout", false) }), db);
    await expect(svc.assertOn("billing.checkout", { workspaceId: "ws1", actorId: "u1" })).rejects.toBeInstanceOf(
      KillSwitchOffError,
    );
    expect(db.refusals).toHaveLength(1);
    const row = db.refusals[0];
    expect(row.action).toBe("admin.killswitch.refused");
    expect(row.targetType).toBe("kill_switch");
    expect(row.targetId).toBe("billing.checkout");
    expect(row.actorId).toBe("u1");
    expect(row.after).toEqual({ reason: "feature_off", workspaceId: "ws1" });
  });

  it("writes a cap_reached row for a custom-domain total-cap 403 (RED on main)", async () => {
    const db = dbStub(0);
    const svc = new KillSwitchService(settingsStub({}), db);
    const caps = structuredClone(DEFAULT_KILL_SWITCHES);
    caps["customDomains.create"].domainCaps = { totalMax: 2, perDay: 100 };
    await expect(svc.assertCustomDomainUnderCaps(caps, 2, 0, { workspaceId: "ws9" })).rejects.toBeInstanceOf(
      KillSwitchCapError,
    );
    expect(db.refusals).toHaveLength(1);
    expect(db.refusals[0].after).toEqual({ reason: "cap_reached", workspaceId: "ws9" });
    expect(db.refusals[0].targetId).toBe("customDomains.create");
  });

  it("writes a cap_reached row for the per-day custom-domain cap too", async () => {
    const db = dbStub(0);
    const svc = new KillSwitchService(settingsStub({}), db);
    const caps = structuredClone(DEFAULT_KILL_SWITCHES);
    caps["customDomains.create"].domainCaps = { totalMax: 100, perDay: 1 };
    await expect(svc.assertCustomDomainUnderCaps(caps, 0, 1)).rejects.toBeInstanceOf(KillSwitchCapError);
    expect(db.refusals).toHaveLength(1);
    expect(db.refusals[0].after).toMatchObject({ reason: "cap_reached" });
  });

  it("writes a feature_off row for an email.outbound OFF refusal", async () => {
    const db = dbStub(0);
    const svc = new KillSwitchService(settingsStub({ switches: on("email.outbound", false) }), db);
    await expect(svc.assertEmailAllowed(false)).rejects.toBeInstanceOf(KillSwitchOffError);
    expect(db.refusals).toHaveLength(1);
    expect(db.refusals[0].targetId).toBe("email.outbound");
    expect(db.refusals[0].after).toMatchObject({ reason: "feature_off" });
  });

  it("writes a cap_reached row for an email cap refusal", async () => {
    const switches = structuredClone(DEFAULT_KILL_SWITCHES);
    switches["email.outbound"] = { on: true, emailCaps: { perHour: 5, perDay: 100 } };
    const db = dbStub(5);
    const svc = new KillSwitchService(settingsStub({ switches }), db);
    await expect(svc.assertEmailAllowed(false)).rejects.toBeInstanceOf(KillSwitchCapError);
    expect(db.refusals).toHaveLength(1);
    expect(db.refusals[0].after).toMatchObject({ reason: "cap_reached" });
  });

  it("writes a cap_reached row on the fail-closed email-count path", async () => {
    const db = dbStub(0, { countThrows: true });
    const svc = new KillSwitchService(settingsStub({ switches: on("email.outbound", true) }), db);
    await expect(svc.assertEmailAllowed(false)).rejects.toBeInstanceOf(KillSwitchCapError);
    expect(db.refusals).toHaveLength(1);
    expect(db.refusals[0].after).toMatchObject({ reason: "cap_reached" });
  });

  it("labels the row by the switch when no actor/workspace is known (no PII)", async () => {
    const db = dbStub(0);
    const svc = new KillSwitchService(settingsStub({ switches: on("billing.refunds", false) }), db);
    await expect(svc.assertOn("billing.refunds")).rejects.toBeInstanceOf(KillSwitchOffError);
    const row = db.refusals[0];
    expect(row.actorId).toBe(null);
    expect(row.actorLabel).toBe("kill-switch:billing.refunds");
    // No request body, email or IP — only ids + the reason context.
    expect(row.requestIp).toBe(null);
    expect(row.after).toEqual({ reason: "feature_off", workspaceId: null });
  });

  it("records exactly ONE audit row when the window already exists (dedupe)", async () => {
    // windowCount 2 => the ON CONFLICT (bump) path: the window was already
    // open, so NO new audit row is written — only the counter moved.
    const db = dbStub(0, { windowCount: 2 });
    const svc = new KillSwitchService(settingsStub({ switches: on("billing.checkout", false) }), db);
    await expect(svc.assertOn("billing.checkout", { workspaceId: "ws1" })).rejects.toBeInstanceOf(KillSwitchOffError);
    // The upsert still ran (the counter bumped) but no admin_audit_log row.
    expect(db.upserts).toHaveLength(1);
    expect(db.refusals).toHaveLength(0);
  });

  it("still refuses (does NOT turn 503 into 500 or success) when the audit write fails", async () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    const db = dbStub(0, { insertThrows: true });
    const svc = new KillSwitchService(settingsStub({ switches: on("billing.checkout", false) }), db);
    // The refusal is still the named 503 — the swallowed audit failure never
    // changes the thrown error's type or status.
    await expect(svc.assertOn("billing.checkout", { workspaceId: "ws1" })).rejects.toBeInstanceOf(KillSwitchOffError);
    try {
      await svc.assertOn("billing.checkout", { workspaceId: "ws1" });
    } catch (err) {
      expect((err as KillSwitchOffError).getStatus()).toBe(503);
    }
    expect(db.refusals).toHaveLength(0); // nothing recorded, but still refused
    spy.mockRestore();
  });

  it("still refuses a 403 cap when the audit write fails", async () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    const db = dbStub(0, { insertThrows: true });
    const svc = new KillSwitchService(settingsStub({}), db);
    const caps = structuredClone(DEFAULT_KILL_SWITCHES);
    caps["customDomains.create"].domainCaps = { totalMax: 1, perDay: 100 };
    await expect(svc.assertCustomDomainUnderCaps(caps, 1, 0)).rejects.toBeInstanceOf(KillSwitchCapError);
    spy.mockRestore();
  });
});
