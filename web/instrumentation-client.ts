/* Browser-side Sentry init (#995). Next loads this before the app hydrates.
   OFF unless NEXT_PUBLIC_SENTRY_DSN is set — with no DSN this is a no-op and the
   SDK never initialises, so a self-hosted / OSS build ships no error tracking
   and makes no network call. Policy (scrubbing, sample rates, no PII) lives in
   src/lib/telemetry.ts so client, server and edge stay identical. */
import * as Sentry from "@sentry/nextjs";
import { isTelemetryEnabled, sentryInitOptions } from "@/lib/telemetry";

if (isTelemetryEnabled) {
  Sentry.init(sentryInitOptions());
}

/* Required by Sentry's Next.js navigation instrumentation. A no-op export when
   disabled (Sentry.captureRouterTransitionStart is safe to reference; it does
   nothing until init runs). */
export const onRouterTransitionStart = Sentry.captureRouterTransitionStart;
