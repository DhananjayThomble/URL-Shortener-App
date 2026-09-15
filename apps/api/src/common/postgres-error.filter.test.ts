import { describe, expect, it, vi } from "vitest";
import { NotFoundException, type ArgumentsHost } from "@nestjs/common";
import { PostgresErrorFilter } from "./postgres-error.filter.js";

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

function hostFor(raw: { headersSent: boolean; writableEnded: boolean; destroy: () => void }) {
  const reply = {
    raw,
    status: vi.fn(() => reply),
    send: vi.fn(() => reply),
  };
  const host = {
    switchToHttp: () => ({
      getResponse: () => reply,
      getRequest: () => ({}),
    }),
  } as unknown as ArgumentsHost;
  return { host, reply };
}

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
});
