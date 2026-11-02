/* ============================================================
   API error tracking (#995).

   A thin wrapper over @snapurl/telemetry's initNodeTelemetry that:
     - resolves the DSN at cold start (Secrets Manager via SENTRY_DSN_SECRET_ARN
       on AWS, or the plain SENTRY_DSN locally — see resolveSentryDsn), so the
       init stays OFF unless a DSN is configured;
     - holds the resulting handle as a module-level singleton so the global
       exception filter (which Nest constructs, not us) can reach it without DI
       plumbing or a circular import;
     - exposes the SamplingController the #1020 runtime kill switch will plug
       into once it lands.

   The handle is always present after bootstrap: on the no-DSN path it is the
   disabled no-op handle, so callers never branch on "is telemetry configured".
   ============================================================ */

import { initNodeTelemetry, SamplingController, type NodeTelemetry } from "@snapurl/telemetry";
import { resolveSentryDsn } from "@snapurl/database";
import type { Env } from "../config/env.js";

/** The disabled handle used before bootstrap and whenever no DSN is set. A real
 *  SamplingController built with dsnConfigured:false, so shouldSend() is false
 *  and the rates are 0 — identical to what initNodeTelemetry returns on the
 *  no-DSN path, just available before bootstrap has run. */
const DISABLED: NodeTelemetry = {
  enabled: false,
  sampling: new SamplingController({ dsnConfigured: false, errorsSampleRate: 0, tracesSampleRate: 0 }),
  setContext: () => {},
  captureException: () => undefined,
};

let handle: NodeTelemetry = DISABLED;

/** The current telemetry handle. Safe to call any time — returns the disabled
 *  no-op handle until initApiTelemetry() has run. */
export function telemetry(): NodeTelemetry {
  return handle;
}

/**
 * Resolve the DSN and initialise error tracking for the API. Returns any
 * secret-resolution error for the caller to log once the logger exists (never
 * throws — a telemetry problem must not fail the API boot). A no-op leaving the
 * disabled handle in place when no DSN is configured.
 */
export async function initApiTelemetry(env: Env): Promise<{ error?: Error; enabled: boolean }> {
  const { dsn, error } = await resolveSentryDsn();
  handle = initNodeTelemetry({
    service: "api",
    dsn,
    environment: env.SENTRY_ENVIRONMENT ?? env.NODE_ENV,
    release: env.SENTRY_RELEASE,
    errorsSampleRate: env.SENTRY_ERRORS_SAMPLE_RATE,
    tracesSampleRate: env.SENTRY_TRACES_SAMPLE_RATE,
  });
  return { error, enabled: handle.enabled };
}

/** Test-only: reset the singleton to the disabled handle. */
export function __resetApiTelemetryForTests(): void {
  handle = DISABLED;
}

/** Test-only: install a handle directly (e.g. one built over a mock Sentry) so
 *  the exception filter can be exercised without resolving a real DSN. */
export function __setApiTelemetryForTests(h: NodeTelemetry): void {
  handle = h;
}
