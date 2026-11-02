import { ForbiddenException, Inject, Injectable, Logger, ServiceUnavailableException } from "@nestjs/common";
import { countEmailsSince, recordEmailSent, recordKillSwitchRefusal, type Database } from "@snapurl/database";
import {
  DEFAULT_KILL_SWITCHES,
  KILL_SWITCH_LABELS,
  failClosedKillSwitches,
  foldKillSwitches,
  killSwitchRefusalDedupeKey,
  type KillSwitchesSetting,
  type KillSwitchKey,
  type KillSwitchRefusalReason,
  type KillSwitchRefusalSubject,
} from "@snapurl/contract";
import { DB } from "../database/database.module.js";
import { PlatformSettingsService, SETTINGS_CACHE_TTL_MS } from "./platform-settings.service.js";
import { telemetry } from "../common/telemetry.js";

/** How the kill switches reach error-tracking. #995's SamplingController exposes
 *  setRuntimeControls({enabled, sampleRateCap}); this is the shape we push. A
 *  seam so a unit test can supply a spy instead of the live telemetry handle. */
export type ErrorTrackingSync = (controls: { enabled: boolean; sampleRateCap: number }) => void;

/** The production sync: push the errorTracking switch + cap into the live
 *  telemetry SamplingController (#995). OFF sets enabled:false so shouldSend()
 *  returns false and no event is sent; the cap lowers the effective sample rate
 *  (never above the env ceiling). Reaches the module-level singleton, so it is
 *  a no-op disabled handle before bootstrap and whenever no DSN is configured. */
const liveErrorTrackingSync: ErrorTrackingSync = (controls) => {
  telemetry().sampling.setRuntimeControls(controls);
};

/* ============================================================
   #1020 — the enforcement engine for the typed kill-switch set.

   Every cost-incurring feature asks this service before it acts. The two checks:

     • assertOn(key)        — refuse (a named 503) when the feature's switch is
                              OFF, so nothing changes and the caller sees WHY.
     • assertUnderDailyCap / assertUnderEmailCaps — refuse the N+1th action
                              (a named 403) when a hard cap would be exceeded.

   FAIL CLOSED: reads go through PlatformSettingsService's short cache, but a
   read that THROWS (the DB is unreachable) does not propagate — it resolves to
   failClosedKillSwitches(), where every PAID switch reads OFF. So "I can't read
   the settings" refuses a paid action rather than letting it through. The
   webhook path never calls this service, so it is never switched off (the
   issue's never-off invariant is structural, not a flag here).

   The REFUSAL is a typed exception the caller lets propagate: KillSwitchOffError
   (→ 503, reason feature_off) and KillSwitchCapError (→ 403, reason cap_reached).
   Both carry the switch key and the stable reason code so the admin panel and
   the audit trail can count refusals without parsing prose.
   ============================================================ */

/** Raised when a feature's switch is OFF (including fail-closed OFF). Maps to a
 *  503 — the feature is deliberately unavailable right now, not a client error.
 *  Carries the switch key and the stable `feature_off` reason. */
export class KillSwitchOffError extends ServiceUnavailableException {
  readonly reason: KillSwitchRefusalReason = "feature_off";
  constructor(readonly switchKey: KillSwitchKey) {
    super(`${KILL_SWITCH_LABELS[switchKey]} is turned off right now. No change was made.`);
    this.name = "KillSwitchOffError";
  }
}

/** Raised when an action would exceed a hard cap (the N+1th action). Maps to a
 *  403 — the request is well-formed but the cap refuses it. Carries the switch
 *  key and the stable `cap_reached` reason. */
export class KillSwitchCapError extends ForbiddenException {
  readonly reason: KillSwitchRefusalReason = "cap_reached";
  constructor(
    readonly switchKey: KillSwitchKey,
    readonly cap: number,
    readonly dimension: string,
  ) {
    super(
      `${KILL_SWITCH_LABELS[switchKey]} has reached its ${dimension} cap of ${cap}. Try again later; no change was made.`,
    );
    this.name = "KillSwitchCapError";
  }
}

@Injectable()
export class KillSwitchService {
  private readonly logger = new Logger(KillSwitchService.name);

  /** #1020↔#995 — how the errorTracking switch reaches the telemetry sampling
   *  controller. A plain FIELD with a default (NOT a constructor parameter):
   *  under `nest build` (tsc + emitDecoratorMetadata) Nest resolves every ctor
   *  param by its reflected type, and an ErrorTrackingSync is a Function, not a
   *  provider — so making it a ctor param reds DI with UnknownDependencies at
   *  app bootstrap (the compose/stack harness caught this). A test swaps it via
   *  setErrorTrackingSyncForTesting. */
  private errorTrackingSync: ErrorTrackingSync = liveErrorTrackingSync;

  constructor(
    private readonly settings: PlatformSettingsService,
    @Inject(DB) private readonly db: Database,
  ) {}

  /** Test-only: replace the telemetry sync so a test can assert what the
   *  errorTracking switch pushes without the live telemetry singleton. */
  setErrorTrackingSyncForTesting(sync: ErrorTrackingSync): void {
    this.errorTrackingSync = sync;
  }

  /** The runtime cache window in ms, surfaced so the admin view can show the
   *  effective state's TTL. */
  get cacheTtlMs(): number {
    return SETTINGS_CACHE_TTL_MS;
  }

  /**
   * The effective kill-switch set right now, through the short cache, FAILING
   * CLOSED. A read that throws (DB unreachable) resolves to
   * failClosedKillSwitches() — every paid switch OFF — rather than propagating.
   * This is the one read every check and consumer goes through.
   *
   * Every read also pushes the errorTracking switch + sample-rate cap into the
   * telemetry SamplingController (#995 seam), so a change takes effect within
   * the settings-cache window with no re-init: OFF stops every event, the cap
   * bounds the rate. The push is cheap and idempotent (setRuntimeControls just
   * stores the values), and it runs on the fail-closed path too so an
   * unreadable store leaves error tracking on its shipped default rather than
   * silently stale.
   */
  async current(): Promise<KillSwitchesSetting> {
    let switches: KillSwitchesSetting;
    try {
      switches = await this.settings.getKillSwitches();
    } catch (err) {
      this.logger.error({ err }, "kill-switch read failed — failing closed (paid switches OFF)");
      switches = failClosedKillSwitches();
    }
    this.pushErrorTracking(switches);
    return switches;
  }

  /** Push the current errorTracking switch + cap into the telemetry sampling
   *  controller. Best-effort: a telemetry failure never breaks a settings read. */
  private pushErrorTracking(switches: KillSwitchesSetting): void {
    const state = switches.errorTracking;
    const cap = state.errorCaps ?? DEFAULT_KILL_SWITCHES.errorTracking.errorCaps!;
    try {
      this.errorTrackingSync({ enabled: state.on, sampleRateCap: cap.sampleRate });
    } catch (err) {
      this.logger.warn({ err }, "could not sync errorTracking kill switch to telemetry");
    }
  }

  /** Whether one switch is ON right now (fail-closed). A plain boolean read for
   *  a worker-style or best-effort caller that does not want an exception. */
  async isOn(key: KillSwitchKey): Promise<boolean> {
    return (await this.current())[key].on;
  }

  /**
   * Refuse with a named 503 when `key` is OFF. The caller lets the exception
   * propagate; nothing it was about to do runs, so "a switched-off feature
   * refuses and changes nothing" holds by construction — the guard is BEFORE
   * the side effect.
   *
   * `subject` names the actor/workspace the refusal is for (#1032). It is
   * OPTIONAL: a caller that has no principal to hand still refuses correctly;
   * the refusal is then audited attributed to the switch alone. Passing it lets
   * the audit row carry the actor and workspace ids so an operator can see WHO
   * is hitting a switched-off feature.
   */
  async assertOn(key: KillSwitchKey, subject?: KillSwitchRefusalSubject): Promise<void> {
    if (!(await this.current())[key].on) {
      await this.auditRefusal(key, "feature_off", subject);
      throw new KillSwitchOffError(key);
    }
  }

  /**
   * #1032 — record one kill-switch refusal on the platform audit trail, deduped
   * to one row per (switch, reason, subject) per minute with a counter.
   *
   * FAIL SAFE BY DESIGN: this NEVER throws. A failed audit write is logged and
   * swallowed, so it can never turn a refusal into a success and never turns
   * the named 503/403 into a 500 — the caller throws the refusal regardless of
   * what happens here. The audit is observability; the refusal is the contract.
   *
   * Called BEFORE the typed error is thrown, but it writes nothing the caller's
   * action changed — the refusal already changed nothing — so ordering is safe.
   */
  private async auditRefusal(
    key: KillSwitchKey,
    reason: KillSwitchRefusalReason,
    subject: KillSwitchRefusalSubject = {},
  ): Promise<void> {
    try {
      const dedupeKey = killSwitchRefusalDedupeKey(key, reason, subject, Date.now());
      await recordKillSwitchRefusal(this.db, {
        dedupeKey,
        switchKey: key,
        reason,
        actorId: subject.actorId ?? null,
        actorLabel: subject.actorLabel ?? null,
        workspaceId: subject.workspaceId ?? null,
      });
    } catch (err) {
      // A refusal must still refuse even if the audit write fails. Log and
      // move on; the caller throws the 503/403 next. Never rethrow.
      this.logger.error({ err, key, reason }, "could not audit kill-switch refusal — refusing anyway");
    }
  }

  /**
   * Enforce the custom-domains hard caps for ONE new domain. `currentTotal` is
   * how many custom domains already exist platform-wide; `addedToday` is how
   * many were added in the trailing 24h. Refuses the N+1th: at or over either
   * cap, a KillSwitchCapError. The switch's own ON/OFF is checked separately
   * via assertOn — this is only the cap, so a caller does both.
   */
  async assertCustomDomainUnderCaps(
    switches: KillSwitchesSetting,
    currentTotal: number,
    addedToday: number,
    subject?: KillSwitchRefusalSubject,
  ): Promise<void> {
    const caps = switches["customDomains.create"].domainCaps ?? DEFAULT_KILL_SWITCHES["customDomains.create"].domainCaps!;
    if (currentTotal >= caps.totalMax) {
      await this.auditRefusal("customDomains.create", "cap_reached", subject);
      throw new KillSwitchCapError("customDomains.create", caps.totalMax, "total");
    }
    if (addedToday >= caps.perDay) {
      await this.auditRefusal("customDomains.create", "cap_reached", subject);
      throw new KillSwitchCapError("customDomains.create", caps.perDay, "per-day");
    }
  }

  /**
   * Gate ONE outbound email against the email.outbound switch AND its caps.
   *
   * `authCritical` mail (verification, password reset) BYPASSES the OFF switch
   * — it must still go out when an operator has paused marketing/notification
   * mail — but it is STILL counted against the hourly and daily caps and
   * refused past them, so a reset storm cannot run up an unbounded bill. This
   * is the documented exception the issue requires.
   *
   * Returns nothing on success; the caller then sends and calls
   * {@link recordSentEmail}. Throws KillSwitchOffError (non-auth-critical mail
   * while the switch is OFF) or KillSwitchCapError (either cap reached).
   */
  async assertEmailAllowed(authCritical: boolean, subject?: KillSwitchRefusalSubject): Promise<void> {
    const switches = await this.current();
    const state = switches["email.outbound"];

    // Non-auth-critical mail is blocked outright when the switch is OFF. Auth-
    // critical mail is allowed through the OFF switch (documented bypass) but
    // still falls through to the cap check below.
    if (!state.on && !authCritical) {
      await this.auditRefusal("email.outbound", "feature_off", subject);
      throw new KillSwitchOffError("email.outbound");
    }

    const caps = state.emailCaps ?? DEFAULT_KILL_SWITCHES["email.outbound"].emailCaps!;
    // Count failing closed too: if the count read throws, treat the window as
    // full and refuse rather than risk an uncapped send.
    let sentHour: number;
    let sentDay: number;
    try {
      [sentHour, sentDay] = await Promise.all([
        countEmailsSince(this.db, 60 * 60_000),
        countEmailsSince(this.db, 24 * 60 * 60_000),
      ]);
    } catch (err) {
      this.logger.error({ err }, "email cap count failed — refusing the send (fail closed)");
      await this.auditRefusal("email.outbound", "cap_reached", subject);
      throw new KillSwitchCapError("email.outbound", caps.perHour, "per-hour");
    }

    if (sentHour >= caps.perHour) {
      await this.auditRefusal("email.outbound", "cap_reached", subject);
      throw new KillSwitchCapError("email.outbound", caps.perHour, "per-hour");
    }
    if (sentDay >= caps.perDay) {
      await this.auditRefusal("email.outbound", "cap_reached", subject);
      throw new KillSwitchCapError("email.outbound", caps.perDay, "per-day");
    }
  }

  /** Record one sent email for the rolling-window caps. Best-effort: a failure
   *  here never fails the send that already happened, it only risks a slightly
   *  stale count on the next check. Call AFTER a successful send. */
  async recordSentEmail(authCritical: boolean): Promise<void> {
    try {
      await recordEmailSent(this.db, authCritical);
    } catch (err) {
      this.logger.warn({ err }, "could not record outbound-email send for the cap ledger");
    }
  }

  /** The effective error-tracking policy for #995's shouldSend()/sampleRate
   *  seam: whether reporting is on, and the sample-rate ceiling. Reads the
   *  switch fail-closed-safely (errorTracking ships ON, so an unreadable store
   *  keeps reporting at the shipped rate rather than silencing it). */
  async errorTrackingPolicy(): Promise<{ on: boolean; sampleRate: number }> {
    const state = (await this.current()).errorTracking;
    const caps = state.errorCaps ?? DEFAULT_KILL_SWITCHES.errorTracking.errorCaps!;
    return { on: state.on, sampleRate: caps.sampleRate };
  }

  /** Fold a stored value onto the defaults — re-exported so a caller with a raw
   *  row (e.g. a test) can produce a complete set the same way the store does. */
  static fold(stored: unknown): KillSwitchesSetting {
    return foldKillSwitches(stored);
  }
}
