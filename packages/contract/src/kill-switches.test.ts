import { describe, expect, it } from "vitest";
import {
  CustomDomainsCaps,
  DEFAULT_KILL_SWITCHES,
  EmailCaps,
  ErrorTrackingCaps,
  KILL_SWITCH_KEYS,
  KILL_SWITCH_LABELS,
  KILL_SWITCH_REFUSAL_WINDOW_MS,
  KILL_SWITCH_REFUSED_ACTION,
  KILL_SWITCH_REFUSED_TARGET_TYPE,
  KillSwitchRefusalReason,
  killSwitchRefusalDedupeKey,
  killSwitchRefusalWindowStart,
  KillSwitchState,
  KillSwitchesInput,
  KillSwitchesPatchBody,
  KillSwitchesSetting,
  KillSwitchesView,
  PAID_KILL_SWITCH_KEYS,
  failClosedKillSwitches,
  foldKillSwitchChanges,
  foldKillSwitches,
} from "./kill-switches.js";

/* #1020 — kill-switches.ts is the typed kill-switch set. These tests pin every
   schema with real logic (bounded caps, the 0..1 sample rate, the partial-patch
   "at least one" refinements, the required patch reason), the fold helper's
   field-level merge, and the load-bearing constants (the 9 keys, the paid
   subset, the shipped defaults' on/off and caps). Contract tests import
   describe/expect/it explicitly — vitest globals are not enabled — and this
   file carries behavioural asserts on every export so the package's Stryker
   mutation score stays at/above the 95% gate. */

describe("KILL_SWITCH_KEYS", () => {
  it("is exactly the nine switches the issue scopes", () => {
    expect([...KILL_SWITCH_KEYS]).toEqual([
      "billing.checkout",
      "billing.planChanges",
      "billing.coupons",
      "billing.trials",
      "billing.refunds",
      "customDomains.create",
      "email.outbound",
      "errorTracking",
      "linkScanning.rescans",
    ]);
  });

  it("has a human label for every key", () => {
    for (const key of KILL_SWITCH_KEYS) {
      expect(typeof KILL_SWITCH_LABELS[key]).toBe("string");
      expect(KILL_SWITCH_LABELS[key].length).toBeGreaterThan(0);
    }
  });
});

describe("PAID_KILL_SWITCH_KEYS", () => {
  it("is the six money-incurring switches that fail closed", () => {
    expect([...PAID_KILL_SWITCH_KEYS]).toEqual([
      "billing.checkout",
      "billing.planChanges",
      "billing.coupons",
      "billing.trials",
      "billing.refunds",
      "customDomains.create",
    ]);
  });

  it("does NOT include the background-work switches", () => {
    const paid = new Set<string>(PAID_KILL_SWITCH_KEYS);
    expect(paid.has("email.outbound")).toBe(false);
    expect(paid.has("errorTracking")).toBe(false);
    expect(paid.has("linkScanning.rescans")).toBe(false);
  });

  it("every paid key is a real switch key", () => {
    for (const key of PAID_KILL_SWITCH_KEYS) {
      expect(KILL_SWITCH_KEYS).toContain(key);
    }
  });
});

describe("CustomDomainsCaps", () => {
  it("accepts non-negative bounded integers", () => {
    expect(CustomDomainsCaps.safeParse({ totalMax: 0, perDay: 0 }).success).toBe(true);
    expect(CustomDomainsCaps.safeParse({ totalMax: 10_000, perDay: 500 }).success).toBe(true);
  });

  it("rejects a negative or non-integer cap", () => {
    expect(CustomDomainsCaps.safeParse({ totalMax: -1, perDay: 5 }).success).toBe(false);
    expect(CustomDomainsCaps.safeParse({ totalMax: 2.5, perDay: 5 }).success).toBe(false);
  });

  it("rejects a cap over the 10,000,000 ceiling", () => {
    expect(CustomDomainsCaps.safeParse({ totalMax: 10_000_001, perDay: 5 }).success).toBe(false);
  });

  it("requires both fields", () => {
    expect(CustomDomainsCaps.safeParse({ totalMax: 5 }).success).toBe(false);
    expect(CustomDomainsCaps.safeParse({ perDay: 5 }).success).toBe(false);
  });
});

describe("EmailCaps", () => {
  it("accepts bounded hourly/daily caps", () => {
    expect(EmailCaps.safeParse({ perHour: 0, perDay: 0 }).success).toBe(true);
    expect(EmailCaps.safeParse({ perHour: 5_000, perDay: 50_000 }).success).toBe(true);
  });

  it("rejects a negative cap and requires both fields", () => {
    expect(EmailCaps.safeParse({ perHour: -1, perDay: 10 }).success).toBe(false);
    expect(EmailCaps.safeParse({ perHour: 10 }).success).toBe(false);
  });
});

describe("ErrorTrackingCaps", () => {
  it("accepts a sample rate in [0, 1]", () => {
    expect(ErrorTrackingCaps.safeParse({ sampleRate: 0 }).success).toBe(true);
    expect(ErrorTrackingCaps.safeParse({ sampleRate: 0.25 }).success).toBe(true);
    expect(ErrorTrackingCaps.safeParse({ sampleRate: 1 }).success).toBe(true);
  });

  it("rejects a sample rate outside [0, 1]", () => {
    expect(ErrorTrackingCaps.safeParse({ sampleRate: -0.01 }).success).toBe(false);
    expect(ErrorTrackingCaps.safeParse({ sampleRate: 1.01 }).success).toBe(false);
  });
});

describe("KillSwitchState", () => {
  it("accepts a bare on/off with no caps", () => {
    expect(KillSwitchState.safeParse({ on: true }).success).toBe(true);
    expect(KillSwitchState.safeParse({ on: false }).success).toBe(true);
  });

  it("requires on to be a boolean", () => {
    expect(KillSwitchState.safeParse({}).success).toBe(false);
    expect(KillSwitchState.safeParse({ on: "yes" }).success).toBe(false);
  });

  it("accepts an optional caps object of each kind", () => {
    expect(KillSwitchState.safeParse({ on: true, domainCaps: { totalMax: 1, perDay: 1 } }).success).toBe(true);
    expect(KillSwitchState.safeParse({ on: true, emailCaps: { perHour: 1, perDay: 1 } }).success).toBe(true);
    expect(KillSwitchState.safeParse({ on: true, errorCaps: { sampleRate: 0.5 } }).success).toBe(true);
  });

  it("rejects a malformed caps object", () => {
    expect(KillSwitchState.safeParse({ on: true, errorCaps: { sampleRate: 2 } }).success).toBe(false);
  });
});

describe("KillSwitchesSetting", () => {
  it("accepts the shipped defaults", () => {
    expect(KillSwitchesSetting.safeParse(DEFAULT_KILL_SWITCHES).success).toBe(true);
  });

  it("requires every one of the nine keys", () => {
    const { ["billing.checkout"]: _dropped, ...missingOne } = DEFAULT_KILL_SWITCHES;
    expect(KillSwitchesSetting.safeParse(missingOne).success).toBe(false);
  });
});

describe("DEFAULT_KILL_SWITCHES", () => {
  it("ships billing and custom domains OFF (explicit opt-in + fail-closed)", () => {
    expect(DEFAULT_KILL_SWITCHES["billing.checkout"].on).toBe(false);
    expect(DEFAULT_KILL_SWITCHES["billing.planChanges"].on).toBe(false);
    expect(DEFAULT_KILL_SWITCHES["billing.coupons"].on).toBe(false);
    expect(DEFAULT_KILL_SWITCHES["billing.trials"].on).toBe(false);
    expect(DEFAULT_KILL_SWITCHES["billing.refunds"].on).toBe(false);
    expect(DEFAULT_KILL_SWITCHES["customDomains.create"].on).toBe(false);
  });

  it("ships the cost-incurring background switches ON", () => {
    expect(DEFAULT_KILL_SWITCHES["email.outbound"].on).toBe(true);
    expect(DEFAULT_KILL_SWITCHES.errorTracking.on).toBe(true);
    expect(DEFAULT_KILL_SWITCHES["linkScanning.rescans"].on).toBe(true);
  });

  it("ships conservative initial hard caps on the capped switches (#1030)", () => {
    // #1030 — tightened from the #1020 shipped caps (customDomains 10,000/500,
    // email 5,000/50,000). These are deliberately small initial limits the
    // operator raises on purpose from the admin panel.
    expect(DEFAULT_KILL_SWITCHES["customDomains.create"].domainCaps).toEqual({ totalMax: 25, perDay: 5 });
    expect(DEFAULT_KILL_SWITCHES["email.outbound"].emailCaps).toEqual({ perHour: 200, perDay: 2_000 });
    expect(DEFAULT_KILL_SWITCHES.errorTracking.errorCaps).toEqual({ sampleRate: 1 });
  });
});

describe("KillSwitchesInput", () => {
  it("accepts a single-switch partial change", () => {
    expect(KillSwitchesInput.safeParse({ "billing.checkout": { on: true } }).success).toBe(true);
  });

  it("accepts a caps-only change (no on)", () => {
    expect(
      KillSwitchesInput.safeParse({ "customDomains.create": { domainCaps: { totalMax: 5, perDay: 2 } } }).success,
    ).toBe(true);
  });

  it("rejects an empty body (at least one switch required)", () => {
    expect(KillSwitchesInput.safeParse({}).success).toBe(false);
  });

  it("rejects a switch patch that changes nothing", () => {
    expect(KillSwitchesInput.safeParse({ "billing.checkout": {} }).success).toBe(false);
  });
});

describe("KillSwitchesPatchBody", () => {
  it("requires a non-empty reason alongside a change", () => {
    expect(KillSwitchesPatchBody.safeParse({ "billing.checkout": { on: true }, reason: "abuse wave" }).success).toBe(
      true,
    );
    expect(KillSwitchesPatchBody.safeParse({ "billing.checkout": { on: true } }).success).toBe(false);
    expect(KillSwitchesPatchBody.safeParse({ "billing.checkout": { on: true }, reason: "   " }).success).toBe(false);
  });

  it("rejects a reason over 500 chars", () => {
    expect(
      KillSwitchesPatchBody.safeParse({ "billing.checkout": { on: true }, reason: "x".repeat(501) }).success,
    ).toBe(false);
  });

  it("still requires at least one switch change", () => {
    expect(KillSwitchesPatchBody.safeParse({ reason: "just because" }).success).toBe(false);
  });
});

describe("foldKillSwitchChanges", () => {
  it("flips one switch's `on` and leaves its caps and the others untouched", () => {
    const next = foldKillSwitchChanges(DEFAULT_KILL_SWITCHES, { "billing.checkout": { on: true } });
    expect(next["billing.checkout"].on).toBe(true);
    // caps on an unrelated capped switch unchanged
    expect(next["email.outbound"].emailCaps).toEqual(DEFAULT_KILL_SWITCHES["email.outbound"].emailCaps);
    // a sibling billing switch unchanged
    expect(next["billing.refunds"].on).toBe(false);
  });

  it("edits a cap without touching the switch's on state", () => {
    const next = foldKillSwitchChanges(DEFAULT_KILL_SWITCHES, {
      "customDomains.create": { domainCaps: { totalMax: 3, perDay: 1 } },
    });
    expect(next["customDomains.create"].on).toBe(false); // unchanged
    expect(next["customDomains.create"].domainCaps).toEqual({ totalMax: 3, perDay: 1 });
  });

  it("does not mutate the input current set", () => {
    const current = structuredClone(DEFAULT_KILL_SWITCHES);
    foldKillSwitchChanges(current, { "billing.checkout": { on: true } });
    expect(current["billing.checkout"].on).toBe(false);
  });

  it("applies changes across several switches at once", () => {
    const next = foldKillSwitchChanges(DEFAULT_KILL_SWITCHES, {
      "billing.checkout": { on: true },
      "email.outbound": { on: false },
      errorTracking: { errorCaps: { sampleRate: 0.1 } },
    });
    expect(next["billing.checkout"].on).toBe(true);
    expect(next["email.outbound"].on).toBe(false);
    expect(next.errorTracking.errorCaps).toEqual({ sampleRate: 0.1 });
  });

  it("ignores a key with no patch", () => {
    const next = foldKillSwitchChanges(DEFAULT_KILL_SWITCHES, { "billing.trials": { on: true } });
    expect(next["billing.coupons"]).toEqual(DEFAULT_KILL_SWITCHES["billing.coupons"]);
  });

  it("flipping only `on` on a capped switch leaves its caps defined (does not blank them)", () => {
    // Guards against a fold that applies a cap field even when the patch omits
    // it — an `on`-only change must NOT set domainCaps/emailCaps/errorCaps to
    // undefined.
    const domainChange = foldKillSwitchChanges(DEFAULT_KILL_SWITCHES, { "customDomains.create": { on: true } });
    expect(domainChange["customDomains.create"].domainCaps).toEqual(
      DEFAULT_KILL_SWITCHES["customDomains.create"].domainCaps,
    );
    const emailChange = foldKillSwitchChanges(DEFAULT_KILL_SWITCHES, { "email.outbound": { on: false } });
    expect(emailChange["email.outbound"].emailCaps).toEqual(DEFAULT_KILL_SWITCHES["email.outbound"].emailCaps);
    const errorChange = foldKillSwitchChanges(DEFAULT_KILL_SWITCHES, { errorTracking: { on: false } });
    expect(errorChange.errorTracking.errorCaps).toEqual(DEFAULT_KILL_SWITCHES.errorTracking.errorCaps);
  });

  it("editing one cap leaves the OTHER cap kinds on sibling switches untouched", () => {
    const next = foldKillSwitchChanges(DEFAULT_KILL_SWITCHES, {
      "email.outbound": { emailCaps: { perHour: 1, perDay: 2 } },
    });
    expect(next["email.outbound"].emailCaps).toEqual({ perHour: 1, perDay: 2 });
    // on unchanged, and the domain/error caps on their switches untouched
    expect(next["email.outbound"].on).toBe(DEFAULT_KILL_SWITCHES["email.outbound"].on);
    expect(next["customDomains.create"].domainCaps).toEqual(DEFAULT_KILL_SWITCHES["customDomains.create"].domainCaps);
    expect(next.errorTracking.errorCaps).toEqual(DEFAULT_KILL_SWITCHES.errorTracking.errorCaps);
  });
});

describe("foldKillSwitches", () => {
  it("returns the shipped defaults for null/undefined/garbage", () => {
    expect(foldKillSwitches(null)).toEqual(DEFAULT_KILL_SWITCHES);
    expect(foldKillSwitches(undefined)).toEqual(DEFAULT_KILL_SWITCHES);
    expect(foldKillSwitches("not an object")).toEqual(DEFAULT_KILL_SWITCHES);
    expect(foldKillSwitches(42)).toEqual(DEFAULT_KILL_SWITCHES);
  });

  it("keeps a valid stored switch and defaults the rest", () => {
    const folded = foldKillSwitches({ "billing.checkout": { on: true } });
    expect(folded["billing.checkout"].on).toBe(true);
    expect(folded["billing.refunds"]).toEqual(DEFAULT_KILL_SWITCHES["billing.refunds"]);
    expect(folded["email.outbound"]).toEqual(DEFAULT_KILL_SWITCHES["email.outbound"]);
  });

  it("replaces a malformed switch state with its default (never drops the key)", () => {
    const folded = foldKillSwitches({
      "billing.checkout": { on: "yes" },
      errorTracking: { on: true, errorCaps: { sampleRate: 9 } },
    });
    expect(folded["billing.checkout"]).toEqual(DEFAULT_KILL_SWITCHES["billing.checkout"]);
    expect(folded.errorTracking).toEqual(DEFAULT_KILL_SWITCHES.errorTracking);
  });

  it("does not mutate the shipped defaults constant", () => {
    const folded = foldKillSwitches({ "billing.checkout": { on: true } });
    folded["billing.checkout"].on = false;
    expect(DEFAULT_KILL_SWITCHES["billing.checkout"].on).toBe(false);
  });

  it("a stored cap override WINS over the tightened default; unset keys fall back (#1030)", () => {
    // The operator raised the caps above the #1030 initial hard limits. The
    // stored value must survive the fold unchanged — it is NOT pulled back down
    // to the shipped default — while a switch the operator never stored still
    // gets the new default.
    const folded = foldKillSwitches({
      "customDomains.create": { on: true, domainCaps: { totalMax: 500, perDay: 50 } },
      "email.outbound": { on: true, emailCaps: { perHour: 10_000, perDay: 100_000 } },
    });
    // Stored overrides win over the defaults.
    expect(folded["customDomains.create"]).toEqual({ on: true, domainCaps: { totalMax: 500, perDay: 50 } });
    expect(folded["email.outbound"].emailCaps).toEqual({ perHour: 10_000, perDay: 100_000 });
    // These differ from the tightened defaults — proving the fall-back did not clobber them.
    expect(folded["customDomains.create"].domainCaps).not.toEqual(
      DEFAULT_KILL_SWITCHES["customDomains.create"].domainCaps,
    );
    // A switch with no stored value falls back to the new default.
    expect(folded["billing.checkout"]).toEqual(DEFAULT_KILL_SWITCHES["billing.checkout"]);
    expect(folded.errorTracking).toEqual(DEFAULT_KILL_SWITCHES.errorTracking);
  });
});

describe("failClosedKillSwitches", () => {
  it("forces every paid switch OFF", () => {
    const safe = failClosedKillSwitches();
    for (const key of PAID_KILL_SWITCH_KEYS) {
      expect(safe[key].on).toBe(false);
    }
  });

  it("leaves the background switches on their shipped default", () => {
    const safe = failClosedKillSwitches();
    expect(safe["email.outbound"].on).toBe(DEFAULT_KILL_SWITCHES["email.outbound"].on);
    expect(safe.errorTracking.on).toBe(DEFAULT_KILL_SWITCHES.errorTracking.on);
    expect(safe["linkScanning.rescans"].on).toBe(DEFAULT_KILL_SWITCHES["linkScanning.rescans"].on);
  });

  it("does not mutate the defaults constant", () => {
    failClosedKillSwitches();
    expect(DEFAULT_KILL_SWITCHES["email.outbound"].on).toBe(true);
  });
});

describe("KillSwitchRefusalReason", () => {
  it("is the two stable codes", () => {
    expect(KillSwitchRefusalReason.options).toEqual(["feature_off", "cap_reached"]);
  });

  it("rejects an unknown code", () => {
    expect(KillSwitchRefusalReason.safeParse("nope").success).toBe(false);
  });
});

describe("KillSwitchesView", () => {
  it("accepts a well-formed view", () => {
    const view = {
      values: DEFAULT_KILL_SWITCHES,
      defaults: DEFAULT_KILL_SWITCHES,
      updatedAt: "2026-11-02T00:00:00.000Z",
      updatedBy: "root@example.com",
      cacheTtlMs: 60_000,
    };
    expect(KillSwitchesView.safeParse(view).success).toBe(true);
  });

  it("allows null provenance (never set)", () => {
    const view = {
      values: DEFAULT_KILL_SWITCHES,
      defaults: DEFAULT_KILL_SWITCHES,
      updatedAt: null,
      updatedBy: null,
      cacheTtlMs: 60_000,
    };
    expect(KillSwitchesView.safeParse(view).success).toBe(true);
  });
});


/* #1032 — refusal-audit constants and dedupe helpers. These pin the stable
   action key and target type (the admin audit viewer filters on them), the
   window length, the minute-flooring, and the dedupe key's subject precedence
   (workspace, else actor, else "anon") and per-minute rollover — the whole
   point of the aggregation is that two refusals collapse to one key exactly
   when they should, so every branch of the key is asserted. */
describe("KILL_SWITCH_REFUSED_ACTION", () => {
  it("is the stable audit action key the viewer filters on", () => {
    expect(KILL_SWITCH_REFUSED_ACTION).toBe("admin.killswitch.refused");
  });

  it("fits the admin_audit_log action column (<= 80 chars)", () => {
    expect(KILL_SWITCH_REFUSED_ACTION.length).toBeLessThanOrEqual(80);
  });
});

describe("KILL_SWITCH_REFUSED_TARGET_TYPE", () => {
  it("is the kill_switch target type", () => {
    expect(KILL_SWITCH_REFUSED_TARGET_TYPE).toBe("kill_switch");
  });
});

describe("KILL_SWITCH_REFUSAL_WINDOW_MS", () => {
  it("is one minute", () => {
    expect(KILL_SWITCH_REFUSAL_WINDOW_MS).toBe(60_000);
  });
});

describe("killSwitchRefusalWindowStart", () => {
  it("floors to the start of the containing minute window", () => {
    expect(killSwitchRefusalWindowStart(60_000)).toBe(60_000);
    expect(killSwitchRefusalWindowStart(60_001)).toBe(60_000);
    expect(killSwitchRefusalWindowStart(119_999)).toBe(60_000);
    expect(killSwitchRefusalWindowStart(120_000)).toBe(120_000);
  });

  it("maps everything inside one window to the same start", () => {
    expect(killSwitchRefusalWindowStart(60_000)).toBe(killSwitchRefusalWindowStart(119_999));
  });

  it("maps adjacent windows to different starts", () => {
    expect(killSwitchRefusalWindowStart(59_999)).not.toBe(killSwitchRefusalWindowStart(60_000));
  });
});

describe("killSwitchRefusalDedupeKey", () => {
  it("includes the switch, reason, subject and window, pipe-joined", () => {
    const key = killSwitchRefusalDedupeKey("billing.checkout", "feature_off", { workspaceId: "ws1" }, 60_000);
    expect(key).toBe("billing.checkout|feature_off|ws1|60000");
  });

  it("prefers the workspace id as the subject", () => {
    const key = killSwitchRefusalDedupeKey(
      "billing.checkout",
      "feature_off",
      { workspaceId: "ws1", actorId: "u1" },
      0,
    );
    expect(key).toBe("billing.checkout|feature_off|ws1|0");
  });

  it("falls back to the actor id when there is no workspace", () => {
    const key = killSwitchRefusalDedupeKey("billing.refunds", "feature_off", { actorId: "u1" }, 0);
    expect(key).toBe("billing.refunds|feature_off|u1|0");
  });

  it("falls back to \"anon\" when neither workspace nor actor is known", () => {
    const key = killSwitchRefusalDedupeKey("linkScanning.rescans", "feature_off", {}, 0);
    expect(key).toBe("linkScanning.rescans|feature_off|anon|0");
  });

  it("collapses two refusals in the same minute to the same key", () => {
    const a = killSwitchRefusalDedupeKey("email.outbound", "cap_reached", { workspaceId: "ws1" }, 61_000);
    const b = killSwitchRefusalDedupeKey("email.outbound", "cap_reached", { workspaceId: "ws1" }, 119_999);
    expect(a).toBe(b);
  });

  it("rolls over to a new key in the next minute", () => {
    const a = killSwitchRefusalDedupeKey("email.outbound", "cap_reached", { workspaceId: "ws1" }, 59_999);
    const b = killSwitchRefusalDedupeKey("email.outbound", "cap_reached", { workspaceId: "ws1" }, 60_000);
    expect(a).not.toBe(b);
  });

  it("separates different reasons for the same switch and subject", () => {
    const off = killSwitchRefusalDedupeKey("customDomains.create", "feature_off", { workspaceId: "ws1" }, 0);
    const cap = killSwitchRefusalDedupeKey("customDomains.create", "cap_reached", { workspaceId: "ws1" }, 0);
    expect(off).not.toBe(cap);
  });

  it("separates different switches for the same reason and subject", () => {
    const a = killSwitchRefusalDedupeKey("billing.checkout", "feature_off", { workspaceId: "ws1" }, 0);
    const b = killSwitchRefusalDedupeKey("billing.coupons", "feature_off", { workspaceId: "ws1" }, 0);
    expect(a).not.toBe(b);
  });

  it("separates two different workspaces so each gets its own row", () => {
    const a = killSwitchRefusalDedupeKey("billing.checkout", "feature_off", { workspaceId: "ws1" }, 0);
    const b = killSwitchRefusalDedupeKey("billing.checkout", "feature_off", { workspaceId: "ws2" }, 0);
    expect(a).not.toBe(b);
  });
});
