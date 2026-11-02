/* ============================================================
   Redirect-service error tracking (#995).

   Same shape as the API's wrapper, kept local to the redirect because this
   service is plain Fastify, not Nest, and deliberately imports as little as it
   can on the hot path. OFF unless a DSN is configured: with no SENTRY_DSN (and
   no SENTRY_DSN_SECRET_ARN to resolve one), init is a no-op and the hot path
   makes no telemetry call at all.

   Env read directly from process.env (the redirect has no zod config layer —
   it reads env vars inline, as the rest of main.ts does). Sample rates parse
   through the shared helper so the defaults match the API: errors-only,
   conservative errors rate.
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

export function telemetry(): NodeTelemetry {
  return handle;
}

/**
 * Resolve the DSN and initialise error tracking for the redirect service.
 * Returns any secret-resolution error for the caller to log; never throws, so a
 * telemetry problem cannot stop the redirect from serving. A no-op leaving the
 * disabled handle when no DSN is configured.
 */
export async function initRedirectTelemetry(): Promise<{ error?: Error; enabled: boolean }> {
  const { dsn, error } = await resolveSentryDsn();
  handle = initNodeTelemetry({
    service: "redirect",
    dsn,
    environment: process.env.SENTRY_ENVIRONMENT ?? process.env.NODE_ENV,
    release: process.env.SENTRY_RELEASE,
    errorsSampleRate: parseSampleRate(process.env.SENTRY_ERRORS_SAMPLE_RATE, 1),
    tracesSampleRate: parseSampleRate(process.env.SENTRY_TRACES_SAMPLE_RATE, 0),
  });
  return { error, enabled: handle.enabled };
}

export function __resetRedirectTelemetryForTests(): void {
  handle = DISABLED;
}

export function __setRedirectTelemetryForTests(h: NodeTelemetry): void {
  handle = h;
}
