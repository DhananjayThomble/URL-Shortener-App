/* ============================================================
   Worker error tracking (#995).

   The worker runs two ways: a true Lambda handler (lambda.ts) and a local
   long-running loop (main.ts). Both initialise telemetry once and capture job
   failures through the same handle. OFF unless a DSN is configured: with no
   SENTRY_DSN (and no SENTRY_DSN_SECRET_ARN to resolve one), init is a no-op.

   Initialisation is idempotent and memoised across warm Lambda invocations,
   mirroring the memoised db handle, so a reused execution environment resolves
   the DSN once at cold start and never again.
   ============================================================ */

import { initNodeTelemetry, parseSampleRate, SamplingController, type NodeTelemetry } from "@snapurl/telemetry";
import { resolveSentryDsn } from "@snapurl/database";

const DISABLED: NodeTelemetry = {
  enabled: false,
  sampling: new SamplingController({ dsnConfigured: false, errorsSampleRate: 0, tracesSampleRate: 0 }),
  setContext: () => {},
  captureException: () => undefined,
};

let handle: NodeTelemetry = DISABLED;
let initPromise: Promise<NodeTelemetry> | undefined;

export function telemetry(): NodeTelemetry {
  return handle;
}

/**
 * Resolve the DSN and initialise error tracking for the worker, once. Memoised:
 * concurrent/warm callers share the same in-flight promise and the resolved
 * handle. Never throws — a telemetry problem must not stop the worker's jobs.
 * A no-op leaving the disabled handle when no DSN is configured.
 */
export function initWorkerTelemetry(): Promise<NodeTelemetry> {
  if (handle.enabled) return Promise.resolve(handle);
  if (!initPromise) {
    initPromise = (async () => {
      const { dsn } = await resolveSentryDsn();
      handle = initNodeTelemetry({
        service: "worker",
        dsn,
        environment: process.env.SENTRY_ENVIRONMENT ?? process.env.NODE_ENV,
        release: process.env.SENTRY_RELEASE,
        errorsSampleRate: parseSampleRate(process.env.SENTRY_ERRORS_SAMPLE_RATE, 1),
        tracesSampleRate: parseSampleRate(process.env.SENTRY_TRACES_SAMPLE_RATE, 0),
      });
      return handle;
    })();
  }
  return initPromise;
}

export function __resetWorkerTelemetryForTests(): void {
  handle = DISABLED;
  initPromise = undefined;
}

export function __setWorkerTelemetryForTests(h: NodeTelemetry): void {
  handle = h;
  initPromise = Promise.resolve(h);
}
