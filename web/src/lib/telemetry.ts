/* ============================================================
   Web error tracking (#995) — the shared Sentry.init options.

   Used by instrumentation-client.ts (browser), sentry.server.config.ts and
   sentry.edge.config.ts (the two Next server runtimes). One place decides the
   policy so the client, server and edge runtimes behave identically:

     - OFF unless a DSN is set. The web DSN is NEXT_PUBLIC_SENTRY_DSN (inlined at
       build time, as it must be for the browser). With no DSN, isEnabled is
       false and the init helpers below do nothing — no SDK init, no network.
     - beforeSend runs the SHARED scrubber from @snapurl/telemetry, so the web
       strips exactly the same passwords/tokens/cookies/Authorization/query
       strings/bodies the API/redirect/worker do.
     - release/environment from the build env, so a web event points at the
       exact build (the same SENTRY_RELEASE the backends tag).
     - tracesSampleRate 0 by default (errors only), errors sample rate from a
       conservative env default — the free-tier-safe posture. A runtime cap
       (#1020) is a backend concern; the web honours the env ceiling.
     - sendDefaultPii: false — never attach IPs/cookies automatically. The app
       attaches only the user id + workspace id via setErrorUser().
   ============================================================ */

import { scrubEvent, parseSampleRate, type ScrubbableEvent } from "@snapurl/telemetry/pure";

/** The web DSN, inlined by Next at build time. Empty/absent => tracking OFF. */
const DSN = (process.env.NEXT_PUBLIC_SENTRY_DSN ?? "").trim();

/** True only when a DSN was configured at build time. */
export const isTelemetryEnabled = DSN.length > 0;

/** The init options shared by every runtime. Pass to Sentry.init(). Safe to
 *  compute even when disabled; callers guard on isTelemetryEnabled first. */
export function sentryInitOptions(): Record<string, unknown> {
  return {
    dsn: DSN,
    environment: process.env.NEXT_PUBLIC_SENTRY_ENVIRONMENT ?? process.env.NODE_ENV,
    release: process.env.NEXT_PUBLIC_SENTRY_RELEASE ?? process.env.NEXT_PUBLIC_APP_VERSION,
    tracesSampleRate: parseSampleRate(process.env.NEXT_PUBLIC_SENTRY_TRACES_SAMPLE_RATE, 0),
    sampleRate: parseSampleRate(process.env.NEXT_PUBLIC_SENTRY_ERRORS_SAMPLE_RATE, 1),
    sendDefaultPii: false,
    // The shared scrubber is the last thing to touch an event before send.
    beforeSend(event: ScrubbableEvent) {
      return scrubEvent(event);
    },
  };
}
