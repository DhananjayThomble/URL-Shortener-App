import { describe, expect, it } from "vitest";
import { isTelemetryEnabled, sentryInitOptions } from "./telemetry.js";
import type { ScrubbableEvent } from "@snapurl/telemetry/pure";

/* #995 — the web's shared Sentry init options. The DSN is read from
   NEXT_PUBLIC_SENTRY_DSN at import; the test env sets none, so isTelemetryEnabled
   is false (the off-without-DSN proof for the web). We also assert the beforeSend
   hook runs the shared scrubber and the free-tier-safe sampling defaults. */

describe("web telemetry init options", () => {
  it("is OFF when no NEXT_PUBLIC_SENTRY_DSN is set at build time", () => {
    expect(isTelemetryEnabled).toBe(false);
  });

  it("wires the shared scrubber as beforeSend", () => {
    const opts = sentryInitOptions();
    const beforeSend = opts.beforeSend as (e: ScrubbableEvent) => ScrubbableEvent;
    const out = beforeSend({
      request: { url: "https://app/x?token=leak", headers: { authorization: "Bearer t" }, data: { password: "p" } },
      extra: { accessToken: "at" },
    });
    expect(out.request?.url).toBe("https://app/x");
    expect(out.request?.headers?.authorization).toBeUndefined();
    expect(out.request?.data).toBeUndefined();
    expect(out.extra?.accessToken).toBe("[redacted]");
  });

  it("defaults to errors-only (traces 0) and never attaches PII", () => {
    const opts = sentryInitOptions();
    expect(opts.tracesSampleRate).toBe(0);
    expect(opts.sampleRate).toBe(1); // conservative default; a busy deploy lowers it
    expect(opts.sendDefaultPii).toBe(false);
  });
});
