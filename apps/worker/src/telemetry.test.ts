import { afterEach, describe, expect, it, vi } from "vitest";
import { initNodeTelemetry } from "@snapurl/telemetry";
import { telemetry, __resetWorkerTelemetryForTests, __setWorkerTelemetryForTests } from "./telemetry.js";

/* #995 — the worker's error-tracking seam. One event per service through a
   mocked transport, and the off-without-DSN proof. The worker's lambda.ts /
   main.ts wire telemetry().captureException into the job-failure and handler
   catch paths; here we exercise the handle directly. */

afterEach(() => __resetWorkerTelemetryForTests());

describe("worker telemetry", () => {
  it("off by default: captures nothing and returns no event id", () => {
    expect(telemetry().enabled).toBe(false);
    expect(telemetry().captureException(new Error("job failed"))).toBeUndefined();
  });

  it("with a DSN: captures one event through the mocked transport", () => {
    const sentry = {
      init: vi.fn(),
      setUser: vi.fn(),
      addEventProcessor: vi.fn(),
      captureException: vi.fn(() => "evt_worker_1"),
    };
    __setWorkerTelemetryForTests(
      initNodeTelemetry({ service: "worker", dsn: "https://pub@o1.ingest.sentry.io/3", sentry }),
    );

    const id = telemetry().captureException(new Error("rollup failed"), { requestId: "worker:maintenance" });
    expect(id).toBe("evt_worker_1");
    expect(sentry.captureException).toHaveBeenCalledTimes(1);
    const hint = sentry.captureException.mock.calls[0]?.[1] as { tags?: Record<string, unknown> };
    expect(hint.tags?.request_id).toBe("worker:maintenance");
  });
});
