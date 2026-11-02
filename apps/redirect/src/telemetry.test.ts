import { afterEach, describe, expect, it, vi } from "vitest";
import { initNodeTelemetry } from "@snapurl/telemetry";
import { telemetry, __resetRedirectTelemetryForTests, __setRedirectTelemetryForTests } from "./telemetry.js";

/* #995 — the redirect's error-tracking seam. One event per service through a
   mocked transport, and the off-without-DSN proof. The redirect's main.ts wires
   telemetry().captureException into a Fastify setErrorHandler; here we exercise
   the handle directly so no live server is needed. */

afterEach(() => __resetRedirectTelemetryForTests());

describe("redirect telemetry", () => {
  it("off by default: captures nothing and returns no event id", () => {
    expect(telemetry().enabled).toBe(false);
    expect(telemetry().captureException(new Error("x"), { requestId: "r" })).toBeUndefined();
  });

  it("with a DSN: captures one scrubbed event through the mocked transport, linked to the request id", () => {
    const sentry = {
      init: vi.fn(),
      setUser: vi.fn(),
      addEventProcessor: vi.fn(),
      captureException: vi.fn(() => "evt_redirect_1"),
    };
    __setRedirectTelemetryForTests(
      initNodeTelemetry({ service: "redirect", dsn: "https://pub@o1.ingest.sentry.io/2", sentry }),
    );

    const id = telemetry().captureException(new Error("resolve failed"), { requestId: "req-abc" });
    expect(id).toBe("evt_redirect_1");
    expect(sentry.captureException).toHaveBeenCalledTimes(1);
    const hint = sentry.captureException.mock.calls[0]?.[1] as { tags?: Record<string, unknown> };
    expect(hint.tags?.request_id).toBe("req-abc");
  });
});
