/* Next's server/edge instrumentation hook (#995). register() loads the matching
   Sentry init for whichever runtime is booting; onRequestError forwards a
   server-side request error to Sentry (a no-op when the SDK never initialised,
   i.e. no DSN). Both are safe to wire unconditionally — Sentry's helpers do
   nothing until Sentry.init() has run, which only happens when a DSN is set. */
import * as Sentry from "@sentry/nextjs";

export async function register() {
  if (process.env.NEXT_RUNTIME === "nodejs") {
    await import("../sentry.server.config");
  }
  if (process.env.NEXT_RUNTIME === "edge") {
    await import("../sentry.edge.config");
  }
}

export const onRequestError = Sentry.captureRequestError;
