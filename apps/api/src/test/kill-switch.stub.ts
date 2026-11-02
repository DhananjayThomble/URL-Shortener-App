import { DEFAULT_KILL_SWITCHES, foldKillSwitchChanges, type KillSwitchesInput, type KillSwitchesSetting } from "@snapurl/contract";
import type { KillSwitchService } from "../admin/kill-switch.service.js";

/* #1020 — a KillSwitchService stub for tests that construct a gated service
   (BillingService, DomainsService, …) directly, not through Nest DI, and are
   NOT themselves about the kill switches.

   It behaves like the real service with a chosen set of switch states, but
   without a settings store or a DB: assertOn / isOn read the set, the email and
   domain gates apply, and the recording/counting hooks are no-ops. By default
   it is "all paid switches ON" so a plain refund/checkout/domain-add test runs
   exactly as it did before #1020 added the gate. A test ABOUT a switch passes
   overrides to turn one off, or sets email/domain counters.

   The real enforcement logic (assertEmailAllowed's bypass + cap arithmetic,
   assertCustomDomainUnderCaps) is covered by kill-switch.service.test.ts
   against the real service; this stub only needs to let unrelated tests through. */
export interface KillSwitchStubOptions {
  /** Partial switch changes folded onto an all-ON base (billing/domains forced
   *  ON so a plain test is unimpeded; pass a change to turn one off). */
  changes?: KillSwitchesInput;
  /** Emails already sent in the trailing hour / day, for an email-cap test. */
  emailsThisHour?: number;
  emailsThisDay?: number;
}

/** An all-paid-switches-ON kill-switch set (the test baseline, which differs
 *  from the shipped DEFAULT where billing/domains are OFF). */
export function allOnKillSwitches(): KillSwitchesSetting {
  const all = structuredClone(DEFAULT_KILL_SWITCHES);
  for (const key of Object.keys(all) as (keyof KillSwitchesSetting)[]) {
    all[key] = { ...all[key], on: true };
  }
  return all;
}

export function killSwitchStub(options: KillSwitchStubOptions = {}): KillSwitchService {
  const base = allOnKillSwitches();
  const switches = options.changes ? foldKillSwitchChanges(base, options.changes) : base;
  let hour = options.emailsThisHour ?? 0;
  let day = options.emailsThisDay ?? 0;

  const svc = {
    cacheTtlMs: 60_000,
    current: async () => switches,
    isOn: async (key: keyof KillSwitchesSetting) => switches[key].on,
    assertOn: async (key: keyof KillSwitchesSetting) => {
      if (!switches[key].on) {
        const { KillSwitchOffError } = await import("../admin/kill-switch.service.js");
        throw new KillSwitchOffError(key);
      }
    },
    assertCustomDomainUnderCaps: (_s: KillSwitchesSetting, total: number, today: number) => {
      const caps = switches["customDomains.create"].domainCaps!;
      if (total >= caps.totalMax || today >= caps.perDay) {
        throw new Error("cap");
      }
    },
    assertEmailAllowed: async (authCritical: boolean) => {
      const state = switches["email.outbound"];
      if (!state.on && !authCritical) {
        const { KillSwitchOffError } = await import("../admin/kill-switch.service.js");
        throw new KillSwitchOffError("email.outbound");
      }
      const caps = state.emailCaps!;
      if (hour >= caps.perHour || day >= caps.perDay) {
        const { KillSwitchCapError } = await import("../admin/kill-switch.service.js");
        throw new KillSwitchCapError("email.outbound", caps.perHour, "per-hour");
      }
    },
    recordSentEmail: async (_authCritical: boolean) => {
      hour += 1;
      day += 1;
    },
    errorTrackingPolicy: async () => {
      const state = switches.errorTracking;
      return { on: state.on, sampleRate: state.errorCaps!.sampleRate };
    },
  };
  return svc as unknown as KillSwitchService;
}
