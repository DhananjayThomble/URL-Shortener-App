import { afterEach, describe, expect, it, vi } from "vitest";
import { NotFoundException, type ArgumentsHost } from "@nestjs/common";
import { PostgresErrorFilter } from "./postgres-error.filter.js";
import { __resetApiTelemetryForTests } from "./telemetry.js";

/* ============================================================
   PostgresErrorFilter must never attempt a second send once a response's
   head is already on the wire.

   This is the defense-in-depth half of the forms CSV export crash (see
   forms.controller.integration.test.ts): a streaming route that throws after
   writeHead(200) used to reach this filter's unconditional reply.status().send(),
   which raises ERR_HTTP_HEADERS_SENT from inside the filter itself — unhandled,
   and fatal to the process. The guard at the top of catch() has to make that
   path structurally unreachable, independent of whether any particular route
   gets its ordering right.
   ============================================================ */

function hostFor(
  raw: { headersSent: boolean; writableEnded: boolean; destroy: () => void },
  request: Record<string, unknown> = {},
) {
  const reply = {
    raw,
    status: vi.fn(() => reply),
    send: vi.fn(() => reply),
  };
  const host = {
    switchToHttp: () => ({
      getResponse: () => reply,
      getRequest: () => request,
    }),
  } as unknown as ArgumentsHost;
  return { host, reply };
}

afterEach(() => __resetApiTelemetryForTests());

describe("PostgresErrorFilter", () => {
  it("does not call reply.status().send() when the head is already sent", () => {
    const filter = new PostgresErrorFilter();
    const destroy = vi.fn();
    const { host, reply } = hostFor({ headersSent: true, writableEnded: false, destroy });

    // Must not throw ERR_HTTP_HEADERS_SENT or anything else — that is exactly
    // the unhandled exception that used to kill the process.
    expect(() => filter.catch(new NotFoundException("gone"), host)).not.toThrow();

    expect(reply.status).not.toHaveBeenCalled();
    expect(reply.send).not.toHaveBeenCalled();
    expect(destroy).toHaveBeenCalled();
  });

  it("does not call reply.status().send() when the response has already ended", () => {
    const filter = new PostgresErrorFilter();
    const destroy = vi.fn();
    const { host, reply } = hostFor({ headersSent: true, writableEnded: true, destroy });

    expect(() => filter.catch(new Error("boom"), host)).not.toThrow();

    expect(reply.status).not.toHaveBeenCalled();
    expect(reply.send).not.toHaveBeenCalled();
    // Already ended: nothing left to destroy.
    expect(destroy).not.toHaveBeenCalled();
  });

  it("keeps sending a normal response when the head has not been sent yet", () => {
    const filter = new PostgresErrorFilter();
    const destroy = vi.fn();
    const { host, reply } = hostFor({ headersSent: false, writableEnded: false, destroy });

    filter.catch(new NotFoundException("not found"), host);

    expect(reply.status).toHaveBeenCalledWith(404);
    expect(reply.send).toHaveBeenCalled();
    expect(destroy).not.toHaveBeenCalled();
  });

  /* #995 — the error-tracking path. An unexpected 500 is captured to Sentry
     (through the telemetry singleton) with the request id linked, and the event
     id is handed back to the client as errorEventId. With telemetry off (the
     default, no DSN) nothing is captured and the body has no errorEventId. */
  it("off by default: an unhandled 500 captures nothing and returns no errorEventId", () => {
    const filter = new PostgresErrorFilter();
    const { host, reply } = hostFor({ headersSent: false, writableEnded: false, destroy: vi.fn() }, { id: "req-1" });

    filter.catch(new Error("kaboom"), host);

    expect(reply.status).toHaveBeenCalledWith(500);
    const body = reply.send.mock.calls[0]?.[0] as Record<string, unknown>;
    expect(body.statusCode).toBe(500);
    expect(body.errorEventId).toBeUndefined();
  });

  it("with telemetry on: captures one event with the request id and returns its errorEventId", async () => {
    const { initNodeTelemetry } = await import("@snapurl/telemetry");
    const { __setApiTelemetryForTests } = await import("./telemetry.js");
    const sentry = {
      init: vi.fn(),
      setUser: vi.fn(),
      addEventProcessor: vi.fn(),
      captureException: vi.fn(() => "evt_api_1"),
    };
    // Build a handle over the mock Sentry and install it as the singleton so
    // the filter's telemetry().captureException routes through the mock.
    __setApiTelemetryForTests(initNodeTelemetry({ service: "api", dsn: "https://pub@o1.ingest.sentry.io/1", sentry }));

    const filter = new PostgresErrorFilter();
    const { host, reply } = hostFor({ headersSent: false, writableEnded: false, destroy: vi.fn() }, { id: "req-42" });

    filter.catch(new Error("kaboom"), host);

    expect(sentry.captureException).toHaveBeenCalledTimes(1);
    const hint = sentry.captureException.mock.calls[0]?.[1] as { tags?: Record<string, unknown> };
    expect(hint.tags?.request_id).toBe("req-42");
    const body = reply.send.mock.calls[0]?.[0] as Record<string, unknown>;
    expect(body.errorEventId).toBe("evt_api_1");
  });
});
