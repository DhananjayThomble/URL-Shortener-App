import { afterEach, describe, expect, it, vi } from "vitest";
import type { Env } from "../config/env.js";
import { ProjectionNudgeService } from "./projection-nudge.service.js";

/* LambdaClient is mocked at the module level, matching mail.service.test.ts's
   convention for @aws-sdk/client-ses: ProjectionNudgeService is a NestJS
   @Injectable resolved through DI (only ENV is constructor-injected), so a
   module mock exercises the real InvokeCommand shape without adding a DI
   surface a test would have to register a provider for. */
const sendMock = vi.fn();
vi.mock("@aws-sdk/client-lambda", () => ({
  LambdaClient: vi.fn().mockImplementation(() => ({ send: sendMock })),
  InvokeCommand: vi.fn().mockImplementation((input: unknown) => ({ input })),
  InvocationType: { Event: "Event" },
}));

function envStub(overrides: Partial<Env>): Env {
  return {
    MAIL_TRANSPORT: "outbox",
    WEB_ORIGIN: "http://localhost:3000",
    ...overrides,
  } as Env;
}

afterEach(() => {
  sendMock.mockReset();
});

describe("ProjectionNudgeService", () => {
  it("does nothing when WORKER_FUNCTION_NAME is unset (every non-AWS profile)", () => {
    const svc = new ProjectionNudgeService(envStub({}));

    svc.nudge();

    expect(sendMock).not.toHaveBeenCalled();
  });

  it("invokes the worker function asynchronously with {task:'projection'} when set", () => {
    sendMock.mockResolvedValueOnce({});
    const svc = new ProjectionNudgeService(envStub({ WORKER_FUNCTION_NAME: "SnapUrl-WorkerFn-abc123" }));

    svc.nudge();

    expect(sendMock).toHaveBeenCalledTimes(1);
    const call = sendMock.mock.calls[0]![0] as { input: Record<string, unknown> };
    expect(call.input.FunctionName).toBe("SnapUrl-WorkerFn-abc123");
    expect(call.input.InvocationType).toBe("Event");
    const payload = JSON.parse(Buffer.from(call.input.Payload as Uint8Array).toString("utf8"));
    expect(payload).toEqual({ task: "projection" });
  });

  it("never throws when the invoke rejects — the outbox row is already durable regardless", async () => {
    sendMock.mockRejectedValueOnce(new Error("Lambda throttled"));
    const svc = new ProjectionNudgeService(envStub({ WORKER_FUNCTION_NAME: "SnapUrl-WorkerFn-abc123" }));

    expect(() => svc.nudge()).not.toThrow();
    // Let the swallowed rejection's .catch() microtask run before the test ends.
    await new Promise((r) => setTimeout(r, 0));
  });
});
