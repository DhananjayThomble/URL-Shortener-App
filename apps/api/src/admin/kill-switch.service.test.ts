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

/** A DB fake whose email-count query returns a scripted number. countEmailsSince
 *  issues `db.select(...).from(...).where(...)` resolving to `[{ n }]`. */
function dbStub(emailCount: number, throws = false): Database {
  const chain = {
    from: () => chain,
    where: async () => {
      if (throws) throw new Error("count failed");
      return [{ n: emailCount }];
    },
  };
  return {
    select: () => chain,
    insert: () => ({ values: async () => undefined }),
  } as unknown as Database;
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

  it("allows below both caps", () => {
    expect(() => svc.assertCustomDomainUnderCaps(caps, 1, 0)).not.toThrow();
  });

  it("refuses the N+1th on the total cap", () => {
    try {
      svc.assertCustomDomainUnderCaps(caps, 2, 0);
      throw new Error("should have thrown");
    } catch (err) {
      expect(err).toBeInstanceOf(KillSwitchCapError);
      expect((err as KillSwitchCapError).reason).toBe("cap_reached");
      expect((err as KillSwitchCapError).cap).toBe(2);
      expect((err as KillSwitchCapError).getStatus()).toBe(403);
    }
  });

  it("refuses the N+1th on the per-day cap even when total is fine", () => {
    expect(() => svc.assertCustomDomainUnderCaps(caps, 0, 1)).toThrow(KillSwitchCapError);
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
    const svc = new KillSwitchService(settingsStub({ switches: on("email.outbound", true) }), dbStub(0, true));
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
