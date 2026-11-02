/* ============================================================
   The sampling / kill-switch seam (#995, for #1020).

   Two things decide whether an error event actually goes to Sentry:

     1. Is error tracking ON at all?  (shouldSend)
     2. If on, what fraction of error events do we keep?  (sampleRate)

   #1020 is building a runtime admin switch ("errorTracking") with a sample-rate
   cap, in parallel. Rather than guess its shape, this file is the small,
   documented hook it plugs into. Everything here DEFAULTS to the env-driven
   values the service was booted with, so with #1020 absent the behaviour is
   exactly "whatever SENTRY_* said at boot". When #1020 lands it calls
   setRuntimeControls() with the admin's live decision, and every subsequent
   event is gated by it — no re-init, no redeploy.

   Keeping the free tier safe (#995): the default traces sample rate is 0
   (errors only, no performance transactions) and the errors sample rate is a
   conservative env-set fraction. A runtime cap can only ever LOWER the
   effective rate, never raise it above the env ceiling, so the admin switch
   cannot blow the quota past what the operator configured at deploy time.
   ============================================================ */

/** The runtime controls #1020 sets. All optional: an unset field falls back to
 *  the env-configured boot value, so a partial update is fine. */
export interface RuntimeControls {
  /** Master on/off. When false, shouldSend() returns false and nothing is sent
   *  (regardless of DSN). Undefined means "use the boot default" (on). */
  enabled?: boolean;
  /** A CAP on the errors sample rate, 0..1. The effective rate is
   *  min(envSampleRate, cap) — a cap can lower the rate but never raise it
   *  above the env ceiling. Undefined means no cap. */
  sampleRateCap?: number;
}

/** The env-derived defaults captured at init. Immutable for the process; the
 *  runtime controls layer on top of it. */
export interface SamplingDefaults {
  /** Whether a DSN was configured — error tracking can only be on if so. */
  dsnConfigured: boolean;
  /** The errors sample rate from the env (0..1), clamped at init. */
  errorsSampleRate: number;
  /** The traces sample rate from the env (0..1), clamped at init. Default 0. */
  tracesSampleRate: number;
}

function clampRate(n: number): number {
  if (!Number.isFinite(n)) return 0;
  if (n < 0) return 0;
  if (n > 1) return 1;
  return n;
}

/**
 * The live sampling controller. One per service, created at init from the env
 * defaults. #1020 holds a reference and calls setRuntimeControls() on it.
 */
export class SamplingController {
  private readonly defaults: SamplingDefaults;
  private controls: RuntimeControls = {};

  constructor(defaults: SamplingDefaults) {
    this.defaults = {
      dsnConfigured: defaults.dsnConfigured,
      errorsSampleRate: clampRate(defaults.errorsSampleRate),
      tracesSampleRate: clampRate(defaults.tracesSampleRate),
    };
  }

  /** #1020 plugs its admin decision in here. Merges over the current controls,
   *  so it can set just `enabled` or just the cap. Values are clamped. */
  setRuntimeControls(next: RuntimeControls): void {
    const merged: RuntimeControls = { ...this.controls };
    if (next.enabled !== undefined) merged.enabled = next.enabled;
    if (next.sampleRateCap !== undefined) merged.sampleRateCap = clampRate(next.sampleRateCap);
    this.controls = merged;
  }

  /** The current runtime controls (what #1020 last set), for diagnostics. */
  getRuntimeControls(): Readonly<RuntimeControls> {
    return { ...this.controls };
  }

  /**
   * Is error tracking on right now? Off when no DSN was configured, or when the
   * runtime switch (#1020) has turned it off. This is the gate the Sentry init
   * uses to decide whether to initialise at all AND the per-event guard the
   * runtime switch flips without a re-init.
   */
  shouldSend(): boolean {
    if (!this.defaults.dsnConfigured) return false;
    if (this.controls.enabled === false) return false;
    return true;
  }

  /**
   * The effective errors sample rate right now: the env rate, lowered by the
   * runtime cap if one is set. Never raised above the env ceiling. Returns 0
   * when sending is off, so a caller can use this as the single source of truth.
   */
  sampleRate(): number {
    if (!this.shouldSend()) return 0;
    const cap = this.controls.sampleRateCap;
    const base = this.defaults.errorsSampleRate;
    return cap === undefined ? base : Math.min(base, cap);
  }

  /** The traces sample rate — 0 by default (errors only), to keep the free tier
   *  safe. Gated by the on/off switch like the errors rate. */
  tracesSampleRate(): number {
    if (!this.shouldSend()) return 0;
    return this.defaults.tracesSampleRate;
  }
}

/** Parse a 0..1 rate from an env string, falling back to `fallback` when unset
 *  or unparseable. Clamped into range. */
export function parseSampleRate(value: string | undefined, fallback: number): number {
  if (value === undefined || value.trim() === "") return clampRate(fallback);
  const n = Number(value);
  return clampRate(Number.isFinite(n) ? n : fallback);
}
