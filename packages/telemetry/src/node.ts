/* ============================================================
   Node error-tracking init (#995), shared by api / redirect / worker.

   OFF UNLESS A DSN IS SET. This is the load-bearing invariant for self-hosters
   and the free tier: with no SENTRY_DSN in the environment, initNodeTelemetry()
   does NOTHING — no @sentry/node init, no transport, no network call, no
   PII capture hook — and returns a disabled handle. The acceptance's no-DSN
   test asserts exactly that nothing initialises.

   When a DSN IS set it initialises @sentry/node (the official SDK) with:
     - the release tagged as the app version + commit (SENTRY_RELEASE), so an
       event points at the exact build that produced it;
     - beforeSend wired to the shared scrubEvent() so passwords/tokens/cookies/
       Authorization/query strings/bodies never leave (tested in scrub.test.ts);
     - sendDefaultPii: false and a dedicated event processor that STRIPS the
       user ip and email even if something downstream tries to attach them — we
       attach only the user id and workspace id, never an email or an IP (#995);
     - tracesSampleRate 0 by default (errors only) and a conservative errors
       sample rate, both from env, exposed through the SamplingController so the
       #1020 runtime kill switch can lower them live.

   The init takes an injectable `client`/transport seam (the `sentry` param) so
   a test can pass a mock Sentry whose captureException records one event
   through a fake transport — that is how "one event per service via a mocked
   transport" is proven without a real DSN or network.
   ============================================================ */

import * as SentryNode from "@sentry/node";
import { scrubEvent, type ScrubbableEvent } from "./scrub.js";
import { SamplingController, parseSampleRate } from "./sampling.js";

/** The slice of the @sentry/node module surface this init depends on. Kept
 *  structural so a test can supply a mock without importing the real SDK. */
export interface SentryApi {
  init(options: Record<string, unknown>): void;
  setUser(user: { id?: string } | null): void;
  captureException(error: unknown, hint?: unknown): string;
  addEventProcessor(processor: (event: ScrubbableEvent) => ScrubbableEvent | null): void;
  getClient?(): unknown;
}

export interface NodeTelemetryOptions {
  /** The service name tagged on every event, e.g. "api" | "redirect" | "worker". */
  service: string;
  /** The DSN. Absent/empty => telemetry stays OFF and init is a no-op. */
  dsn?: string;
  /** Deployment environment, e.g. "production". Defaults to NODE_ENV. */
  environment?: string;
  /** The release id (version + commit). Defaults to SENTRY_RELEASE env. */
  release?: string;
  /** Errors sample rate 0..1. Defaults to SENTRY_ERRORS_SAMPLE_RATE, then 1. */
  errorsSampleRate?: number;
  /** Traces sample rate 0..1. Defaults to SENTRY_TRACES_SAMPLE_RATE, then 0. */
  tracesSampleRate?: number;
  /** Injectable Sentry module (defaults to the real @sentry/node). Tests pass a
   *  mock with a fake transport here. */
  sentry?: SentryApi;
}

/** The handle initNodeTelemetry returns. `enabled` is false on the no-DSN path.
 *  `sampling` is the controller #1020 plugs into. The capture helpers are safe
 *  to call whether or not telemetry is enabled (they are no-ops when off). */
export interface NodeTelemetry {
  enabled: boolean;
  sampling: SamplingController;
  /** Attach the identity we are allowed to carry: user id and workspace id
   *  ONLY. Never an email, never an IP. Passing nothing/undefined clears it. */
  setContext(ctx: { userId?: string; workspaceId?: string } | undefined): void;
  /**
   * Capture an error, optionally linking it to the request id the logs carry so
   * an event and its log line share one correlation id. Returns the Sentry
   * event id (or undefined when telemetry is off), which callers use to show an
   * error reference to the user (e.g. the #997 feedback errorEventId).
   */
  captureException(error: unknown, opts?: { requestId?: string; workspaceId?: string; userId?: string }): string | undefined;
}

/** Read the default release from the env: SENTRY_RELEASE if set. */
function defaultRelease(): string | undefined {
  const r = process.env.SENTRY_RELEASE;
  return r && r.trim() ? r.trim() : undefined;
}

/**
 * Initialise Node error tracking. A no-op returning a disabled handle when no
 * DSN is configured. See the file header for the full contract.
 */
export function initNodeTelemetry(options: NodeTelemetryOptions): NodeTelemetry {
  const sentry = options.sentry ?? (SentryNode as unknown as SentryApi);
  const dsn = (options.dsn ?? "").trim();
  const dsnConfigured = dsn.length > 0;

  const errorsSampleRate =
    options.errorsSampleRate ?? parseSampleRate(process.env.SENTRY_ERRORS_SAMPLE_RATE, 1);
  const tracesSampleRate =
    options.tracesSampleRate ?? parseSampleRate(process.env.SENTRY_TRACES_SAMPLE_RATE, 0);

  const sampling = new SamplingController({ dsnConfigured, errorsSampleRate, tracesSampleRate });

  // OFF UNLESS A DSN IS SET: do not touch Sentry at all. Return a handle whose
  // capture helpers are no-ops, so call sites need no `if (enabled)` guard.
  if (!dsnConfigured) {
    return {
      enabled: false,
      sampling,
      setContext() {
        /* no-op: telemetry is off */
      },
      captureException() {
        return undefined;
      },
    };
  }

  const release = options.release ?? defaultRelease();
  const environment = options.environment ?? process.env.NODE_ENV ?? "production";

  sentry.init({
    dsn,
    environment,
    ...(release ? { release } : {}),
    // Errors only by default; a runtime cap (#1020) can lower it further.
    sampleRate: sampling.sampleRate(),
    tracesSampleRate: sampling.tracesSampleRate(),
    // NEVER let the SDK attach IPs, cookies or other PII automatically. We
    // attach exactly the user id + workspace id ourselves, below.
    sendDefaultPii: false,
    initialScope: { tags: { service: options.service } },
    // The scrubber is the LAST thing to touch an event before it is sent.
    beforeSend(event: ScrubbableEvent) {
      // Honour the runtime kill switch per-event too: once #1020 turns it off,
      // drop the event even on an already-initialised client.
      if (!sampling.shouldSend()) return null;
      return scrubEvent(event);
    },
  });

  // Defence in depth: strip user.ip_address and user.email from every event,
  // whatever set them. The only user fields we keep are id and workspace id.
  sentry.addEventProcessor((event: ScrubbableEvent) => {
    const user = (event as { user?: Record<string, unknown> }).user;
    if (user && typeof user === "object") {
      const { id, workspaceId } = user as { id?: unknown; workspaceId?: unknown };
      (event as { user?: Record<string, unknown> }).user = {
        ...(id !== undefined ? { id } : {}),
        ...(workspaceId !== undefined ? { workspaceId } : {}),
      };
    }
    return event;
  });

  const setContext: NodeTelemetry["setContext"] = (ctx) => {
    if (!ctx || (ctx.userId === undefined && ctx.workspaceId === undefined)) {
      sentry.setUser(null);
      return;
    }
    // id + workspaceId ONLY. No email, no ip_address.
    sentry.setUser({
      ...(ctx.userId !== undefined ? { id: ctx.userId } : {}),
      ...(ctx.workspaceId !== undefined ? { workspaceId: ctx.workspaceId } : {}),
    } as { id?: string });
  };

  const captureException: NodeTelemetry["captureException"] = (error, opts) => {
    if (!sampling.shouldSend()) return undefined;
    // Link the event to the request id the logs already carry (#995 point 4),
    // and tag the workspace/user id when the caller has them to hand. These ride
    // as tags/extra and are scrubbed by key-name rules like everything else —
    // request_id/user id/workspace id are not sensitive names, so they survive.
    const hint = {
      tags: {
        ...(opts?.requestId ? { request_id: opts.requestId } : {}),
        ...(opts?.workspaceId ? { workspace_id: opts.workspaceId } : {}),
        ...(opts?.userId ? { user_id: opts.userId } : {}),
      },
    };
    return sentry.captureException(error, hint);
  };

  return { enabled: true, sampling, setContext, captureException };
}
