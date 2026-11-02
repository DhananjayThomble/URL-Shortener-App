import { ForbiddenException, Inject, Injectable, Logger, ServiceUnavailableException } from "@nestjs/common";
import {
  countEmailsSince,
  failClosedKillSwitches,
  foldKillSwitches,
  recordEmailSent,
  type Database,
} from "@snapurl/database";
import {
  DEFAULT_KILL_SWITCHES,
  KILL_SWITCH_LABELS,
  type KillSwitchesSetting,
  type KillSwitchKey,
  type KillSwitchRefusalReason,
} from "@snapurl/contract";
import { DB } from "../database/database.module.js";
import { PlatformSettingsService, SETTINGS_CACHE_TTL_MS } from "./platform-settings.service.js";

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

  constructor(
    private readonly settings: PlatformSettingsService,
    @Inject(DB) private readonly db: Database,
  ) {}

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
   */
  async current(): Promise<KillSwitchesSetting> {
    try {
      return await this.settings.getKillSwitches();
    } catch (err) {
      this.logger.error({ err }, "kill-switch read failed — failing closed (paid switches OFF)");
      return failClosedKillSwitches();
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
   */
  async assertOn(key: KillSwitchKey): Promise<void> {
    if (!(await this.current())[key].on) {
      throw new KillSwitchOffError(key);
    }
  }

  /**
   * Enforce the custom-domains hard caps for ONE new domain. `currentTotal` is
   * how many custom domains already exist platform-wide; `addedToday` is how
   * many were added in the trailing 24h. Refuses the N+1th: at or over either
   * cap, a KillSwitchCapError. The switch's own ON/OFF is checked separately
   * via assertOn — this is only the cap, so a caller does both.
   */
  assertCustomDomainUnderCaps(
    switches: KillSwitchesSetting,
    currentTotal: number,
    addedToday: number,
  ): void {
    const caps = switches["customDomains.create"].domainCaps ?? DEFAULT_KILL_SWITCHES["customDomains.create"].domainCaps!;
    if (currentTotal >= caps.totalMax) {
      throw new KillSwitchCapError("customDomains.create", caps.totalMax, "total");
    }
    if (addedToday >= caps.perDay) {
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
  async assertEmailAllowed(authCritical: boolean): Promise<void> {
    const switches = await this.current();
    const state = switches["email.outbound"];

    // Non-auth-critical mail is blocked outright when the switch is OFF. Auth-
    // critical mail is allowed through the OFF switch (documented bypass) but
    // still falls through to the cap check below.
    if (!state.on && !authCritical) {
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
      throw new KillSwitchCapError("email.outbound", caps.perHour, "per-hour");
    }

    if (sentHour >= caps.perHour) {
      throw new KillSwitchCapError("email.outbound", caps.perHour, "per-hour");
    }
    if (sentDay >= caps.perDay) {
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
