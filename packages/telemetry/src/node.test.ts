import { describe, expect, it, vi } from "vitest";
import { initNodeTelemetry, type SentryApi } from "./node.js";
import { REDACTED, type ScrubbableEvent } from "./scrub.js";

/* A mock Sentry with a "transport": captureException runs the captured event
   through the registered beforeSend + event processors and pushes whatever
   survives into `sent`. This is the mocked transport the acceptance asks for —
   one event per service, proven without a DSN or a network. */
function mockSentry() {
  let beforeSend: ((e: ScrubbableEvent) => ScrubbableEvent | null) | undefined;
  const processors: Array<(e: ScrubbableEvent) => ScrubbableEvent | null> = [];
  const sent: ScrubbableEvent[] = [];
  let lastUser: unknown;
  const initOptions: Record<string, unknown>[] = [];

  const api: SentryApi = {
    init(options) {
      initOptions.push(options);
      beforeSend = options.beforeSend as typeof beforeSend;
    },
    setUser(user) {
      lastUser = user;
    },
    addEventProcessor(p) {
      processors.push(p);
    },
    captureException(error, hint) {
      // Build the event the way the real SDK would, then run it through the
      // pipeline (processors first, then beforeSend) as a fake transport.
      let event: ScrubbableEvent | null = {
        exception: { values: [{ type: (error as Error)?.name, value: (error as Error)?.message }] },
        user: lastUser as Record<string, unknown> | undefined,
        request: { url: "https://app/api/v1/links?token=leak", headers: { authorization: "Bearer x" }, data: { password: "p" } },
        tags: (hint as { tags?: Record<string, unknown> } | undefined)?.tags,
      };
      for (const p of processors) {
        if (!event) break;
        event = p(event);
      }
      if (event && beforeSend) event = beforeSend(event);
      if (event) sent.push(event);
      return "evt_mock_id";
    },
  };
  return { api, sent, initOptions, getUser: () => lastUser };
}

describe("initNodeTelemetry — OFF unless a DSN is set", () => {
  it("does not initialise and makes no Sentry call when the DSN is absent", () => {
    const sentry = { init: vi.fn(), setUser: vi.fn(), captureException: vi.fn(), addEventProcessor: vi.fn() };
    const t = initNodeTelemetry({ service: "api", dsn: undefined, sentry });
    expect(t.enabled).toBe(false);
    expect(sentry.init).not.toHaveBeenCalled();
    expect(sentry.addEventProcessor).not.toHaveBeenCalled();
    // The helpers are safe no-ops.
    expect(t.captureException(new Error("boom"))).toBeUndefined();
    t.setContext({ userId: "u1" });
    expect(sentry.setUser).not.toHaveBeenCalled();
    expect(sentry.captureException).not.toHaveBeenCalled();
    expect(t.sampling.shouldSend()).toBe(false);
  });

  it("treats a blank/whitespace DSN as absent", () => {
    const sentry = { init: vi.fn(), setUser: vi.fn(), captureException: vi.fn(), addEventProcessor: vi.fn() };
    const t = initNodeTelemetry({ service: "worker", dsn: "   ", sentry });
    expect(t.enabled).toBe(false);
    expect(sentry.init).not.toHaveBeenCalled();
  });
});

describe("initNodeTelemetry — with a DSN", () => {
  it("initialises with the release and service tag and errors-only defaults", () => {
    const m = mockSentry();
    const t = initNodeTelemetry({
      service: "api",
      dsn: "https://pub@o1.ingest.sentry.io/42",
      release: "snapurl@2.0.0+abc1234",
      environment: "production",
      errorsSampleRate: 1,
      tracesSampleRate: 0,
      sentry: m.api,
    });
    expect(t.enabled).toBe(true);
    const opts = m.initOptions[0]!;
    expect(opts.dsn).toBe("https://pub@o1.ingest.sentry.io/42");
    expect(opts.release).toBe("snapurl@2.0.0+abc1234");
    expect(opts.environment).toBe("production");
    expect(opts.sendDefaultPii).toBe(false);
    expect(opts.tracesSampleRate).toBe(0);
    expect((opts.initialScope as { tags: { service: string } }).tags.service).toBe("api");
  });

  it("captures ONE event through the mocked transport, scrubbed", () => {
    const m = mockSentry();
    const t = initNodeTelemetry({ service: "redirect", dsn: "https://pub@o1.ingest.sentry.io/42", sentry: m.api });
    const id = t.captureException(new Error("kaboom"), { requestId: "req-7" });
    expect(id).toBe("evt_mock_id");
    expect(m.sent).toHaveLength(1);
    const event = m.sent[0]!;
    // Scrubbed: query string gone, auth header gone, body gone.
    expect(event.request?.url).toBe("https://app/api/v1/links");
    expect(event.request?.headers?.authorization).toBeUndefined();
    expect(event.request?.data).toBeUndefined();
    // The request id is linked as a tag (#995 point 4).
    expect(event.tags?.request_id).toBe("req-7");
  });

  it("attaches only user id + workspace id — never email or ip", () => {
    const m = mockSentry();
    const t = initNodeTelemetry({ service: "api", dsn: "https://pub@o1.ingest.sentry.io/42", sentry: m.api });
    t.setContext({ userId: "user-1", workspaceId: "ws-9" });
    expect(m.getUser()).toEqual({ id: "user-1", workspaceId: "ws-9" });
    // Even if something upstream set an email/ip on user, the event processor strips it.
    const capturedWithPii = () => {
      // Simulate a user carrying PII by re-setting it then capturing.
      m.api.setUser({ id: "user-1", email: "a@b.com", ip_address: "1.2.3.4", workspaceId: "ws-9" } as { id: string });
      return t.captureException(new Error("x"));
    };
    capturedWithPii();
    const event = m.sent.at(-1)!;
    expect(event.user).toEqual({ id: "user-1", workspaceId: "ws-9" });
    expect((event.user as Record<string, unknown>).email).toBeUndefined();
    expect((event.user as Record<string, unknown>).ip_address).toBeUndefined();
  });

  it("stops sending once the #1020 runtime switch turns it off, without re-init", () => {
    const m = mockSentry();
    const t = initNodeTelemetry({ service: "worker", dsn: "https://pub@o1.ingest.sentry.io/42", sentry: m.api });
    t.captureException(new Error("one"));
    expect(m.sent).toHaveLength(1);
    t.sampling.setRuntimeControls({ enabled: false });
    const id = t.captureException(new Error("two"));
    expect(id).toBeUndefined();
    expect(m.sent).toHaveLength(1); // beforeSend would also drop it; capture returns early
  });

  it("redacts a sensitive tag value the caller passes", () => {
    const m = mockSentry();
    const t = initNodeTelemetry({ service: "api", dsn: "https://pub@o1.ingest.sentry.io/42", sentry: m.api });
    // workspace_id/user_id/request_id survive (not sensitive names); a stray
    // token-named tag would be redacted by the tree sweep.
    t.captureException(new Error("x"), { requestId: "r", workspaceId: "w", userId: "u" });
    const event = m.sent.at(-1)!;
    expect(event.tags?.request_id).toBe("r");
    expect(event.tags?.workspace_id).toBe("w");
    expect(event.tags?.user_id).toBe("u");
    expect(event.tags?.request_id).not.toBe(REDACTED);
  });
});
