/* Edge-runtime Sentry init (#995), loaded by instrumentation.ts's register().
   OFF unless NEXT_PUBLIC_SENTRY_DSN is set. Shared policy from src/lib/telemetry. */
import * as Sentry from "@sentry/nextjs";
import { isTelemetryEnabled, sentryInitOptions } from "@/lib/telemetry";

if (isTelemetryEnabled) {
  Sentry.init(sentryInitOptions());
}
