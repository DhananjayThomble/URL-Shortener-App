import { z } from "zod";

/* ============================================================
   The only place this app talks to the network.

   Everything goes to the NestJS API at NEXT_PUBLIC_API_URL. There
   are deliberately no Next.js route handlers in this project — if
   you find yourself wanting one, the endpoint belongs in NestJS.

   Setting NEXT_PUBLIC_USE_FIXTURES=true routes the same calls to
   src/lib/api/fixtures.ts instead, for frontend work with no backend
   running. It is opt-in: unset means the real API.
   ============================================================ */

export const API_URL = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:3001/api/v1";

/* Fixtures are opt-IN.
 *
 * This used to read `!== "false"`, which meant any deploy that forgot the
 * variable served src/lib/api/fixtures.ts — roughly 480 lines of invented
 * workspaces, links and analytics — as though it were production data. The
 * site looked entirely functional, which is exactly what made it dangerous:
 * there was no symptom to notice.
 *
 * Defaulting off inverts the failure. Forget the variable now and the app
 * calls the real API and fails visibly if it isn't there, which is a problem
 * someone can actually see and fix. next.config.ts additionally refuses to
 * complete a production build with fixtures switched on. */
export const USE_FIXTURES = process.env.NEXT_PUBLIC_USE_FIXTURES === "true";

const TOKEN_KEY = "snapurl.accessToken";
const REFRESH_KEY = "snapurl.refreshToken";

/** localStorage throws in private mode and some embedded webviews. */
function safeStorage() {
  try {
    if (typeof window === "undefined") return null;
    window.localStorage.getItem("__probe__");
    return window.localStorage;
  } catch {
    return null;
  }
}

export const tokens = {
  get access() {
    return safeStorage()?.getItem(TOKEN_KEY) ?? null;
  },
  get refresh() {
    return safeStorage()?.getItem(REFRESH_KEY) ?? null;
  },
  set(access: string, refresh: string) {
    const s = safeStorage();
    s?.setItem(TOKEN_KEY, access);
    s?.setItem(REFRESH_KEY, refresh);
  },
  clear() {
    const s = safeStorage();
    s?.removeItem(TOKEN_KEY);
    s?.removeItem(REFRESH_KEY);
  },
};

/**
 * The workspace the current access token is bound to (its `wid` claim).
 *
 * Read without verifying the signature, which is fine: it is only ever sent
 * back to the API as a refresh *hint*, and the API honours it only when the
 * user really is an active member of that workspace (#668). Works on an
 * expired token too, which is exactly when refresh needs it.
 */
export function currentWorkspaceId(): string | undefined {
  return workspaceIdOf(tokens.access);
}

export class ApiError extends Error {
  constructor(
    readonly status: number,
    message: string,
    readonly detail?: unknown,
  ) {
    super(message);
    this.name = "ApiError";
  }
}

/**
 * Routes where a 401 means "wrong credentials", not "session expired".
 * The server's parsed message is authoritative for these; the session-expiry
 * override must not apply.
 */
/* Paths where a 401 means "those credentials are wrong", not "your session ended".
   Matched exactly, so each entry must be the real route as declared in
   apps/api/src/auth/auth.controller.ts — a near-miss here silently restores the
   bug for that route. */
const AUTH_CREDENTIAL_PATHS = new Set([
  "/auth/login",
  "/auth/register",
  "/auth/oauth",
  "/auth/password-reset/request",
  "/auth/password-reset/confirm",
  "/auth/email/verify",
  "/auth/email/resend",
]);

/** Turns a failed response into a message a person can act on.
 *
 * @param path  The API path (without base URL), used to decide whether a 401
 *              means "bad credentials" (auth routes) or "session expired"
 *              (authenticated routes).
 */
export async function toApiError(res: Response, path: string): Promise<ApiError> {
  let detail: unknown;
  let message = res.statusText;
  try {
    detail = await res.json();
    const d = detail as { message?: string | string[] };
    if (Array.isArray(d?.message)) message = d.message.join(", ");
    else if (typeof d?.message === "string") message = d.message;
  } catch {
    /* body wasn't JSON — keep the status text */
  }
  if (res.status === 401 && !AUTH_CREDENTIAL_PATHS.has(path))
    message = "Your session has expired. Sign in again to continue.";
  if (res.status === 403) message = "You don't have permission to do that.";
  if (res.status === 429) message = "Too many requests. Wait a moment and try again.";
  if (res.status >= 500) message = "The API is having trouble. Try again in a moment.";
  return new ApiError(res.status, message, detail);
}

type RequestOptions = {
  method?: "GET" | "POST" | "PATCH" | "PUT" | "DELETE";
  body?: unknown;
  signal?: AbortSignal;
  /** Skip the Authorization header (login, register, public preview). */
  anonymous?: boolean;
  /**
   * Let the request outlive the page that started it.
   *
   * Sign-out fires `POST /auth/logout` and immediately navigates to /login.
   * Without this the browser is free to cancel the in-flight request, and the
   * refresh token silently stays valid — the exact bug the logout call exists
   * to fix, reintroduced by a race. `keepalive` tells the browser to finish it.
   */
  keepalive?: boolean;
};

let refreshInFlight: Promise<boolean> | null = null;

/** The `wid` claim of an access token, unverified (see currentWorkspaceId). */
export function workspaceIdOf(access: string | null | undefined): string | undefined {
  if (!access) return undefined;
  try {
    const part = access.split(".")[1];
    if (!part) return undefined;
    const json = atob(part.replace(/-/g, "+").replace(/_/g, "/"));
    const wid = (JSON.parse(json) as { wid?: unknown }).wid;
    return typeof wid === "string" ? wid : undefined;
  } catch {
    return undefined;
  }
}

/* #699 — the workspace a tab is in can change underneath it: another tab
   switches (tokens live in shared localStorage), or a refresh lands somewhere
   other than where the session was because that membership is gone. Either
   way every cached query was answered for the old workspace. This event is how
   the client tells the app shell; WorkspaceChangeGuard (providers.tsx) clears
   the cache and routes to /links. */
export const WORKSPACE_CHANGED_EVENT = "snapurl:workspace-changed";
export const ACCESS_TOKEN_STORAGE_KEY = TOKEN_KEY;

function announceWorkspaceChange(from: string | undefined, to: string | undefined) {
  if (typeof window === "undefined" || !from || !to || from === to) return;
  window.dispatchEvent(new CustomEvent(WORKSPACE_CHANGED_EVENT, { detail: { from, to } }));
}

type RefreshOutcome = { ok: true } | { ok: false; res?: Response };

/** One POST /auth/refresh, serialised with any other in this tab (a refresh
 *  token is single-use: two concurrent rotations would trip reuse detection). */
async function runRefresh(workspaceId: string | undefined): Promise<RefreshOutcome> {
  while (refreshInFlight) await refreshInFlight;
  const refresh = tokens.refresh;
  if (!refresh) return { ok: false };
  let outcome: RefreshOutcome = { ok: false };
  const run = (async () => {
    try {
      const res = await fetch(`${API_URL}/auth/refresh`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(workspaceId ? { refreshToken: refresh, workspaceId } : { refreshToken: refresh }),
      });
      if (!res.ok) {
        outcome = { ok: false, res };
        return false;
      }
      const data = (await res.json()) as { accessToken: string; refreshToken: string };
      tokens.set(data.accessToken, data.refreshToken);
      outcome = { ok: true };
      return true;
    } catch {
      return false;
    } finally {
      refreshInFlight = null;
    }
  })();
  refreshInFlight = run;
  await run;
  return outcome;
}

async function refreshSession(): Promise<boolean> {
  if (!tokens.refresh) return false;
  // A refresh already running answers for this caller too.
  if (refreshInFlight) return refreshInFlight;
  // Stay in the workspace this session is in; without the hint a
  // multi-workspace user would be moved back to their default every
  // time the access token expires (#668).
  const before = currentWorkspaceId();
  const { ok } = await runRefresh(before);
  // #699 — the hint is honoured only while that membership is active; when it
  // is not, the API falls back to the default workspace. That is a workspace
  // change and must be treated as one, not silently absorbed.
  if (ok) announceWorkspaceChange(before, currentWorkspaceId());
  return ok;
}

/**
 * Move this session into `workspaceId` (the switcher, or after accepting an
 * invitation).
 *
 * #699 — always through POST /auth/refresh, which rotates the refresh token
 * and refuses a revoked one. An access token alone can never buy a new one.
 * Resolves only once the new access token is bound to `workspaceId`; the
 * caller owns clearing the cache, since it asked for the change.
 */
export async function enterWorkspace(workspaceId: string): Promise<void> {
  if (USE_FIXTURES) return;
  const { ok, ...rest } = await runRefresh(workspaceId);
  if (!ok) {
    const res = "res" in rest ? rest.res : undefined;
    if (!res || res.status === 401) tokens.clear();
    throw res ? await toApiError(res, "/auth/refresh") : new ApiError(401, "Your session has expired. Sign in again to continue.");
  }
  if (currentWorkspaceId() !== workspaceId) {
    // Refresh fell back: the membership is gone (removed meanwhile).
    throw new ApiError(404, "You're no longer a member of that workspace.");
  }
}

async function rawRequest<T>(path: string, schema: z.ZodType<T>, opts: RequestOptions = {}, retry = true): Promise<T> {
  // Only set Content-Type when there is actually a body to send. Fastify's
  // JSON parser rejects Content-Type: application/json with an empty body
  // (status 400), breaking every bodyless DELETE and any bodyless POST.
  const headers: Record<string, string> = opts.body !== undefined ? { "Content-Type": "application/json" } : {};
  const access = tokens.access;
  if (access && !opts.anonymous) headers.Authorization = `Bearer ${access}`;

  const res = await fetch(`${API_URL}${path}`, {
    method: opts.method ?? "GET",
    headers,
    body: opts.body === undefined ? undefined : JSON.stringify(opts.body),
    signal: opts.signal,
    keepalive: opts.keepalive,
  });

  // One transparent refresh-and-retry on expiry.
  if (res.status === 401 && retry && !opts.anonymous && tokens.refresh) {
    if (await refreshSession()) return rawRequest(path, schema, opts, false);
    tokens.clear();
  }

  if (!res.ok) throw await toApiError(res, path);

  // 204 is the only status that can *never* carry a body per HTTP semantics,
  // but it is not the only one this API actually sends bodyless: password-reset
  // request and email/resend both return 202 with an empty body (anti-enumeration
  // — see hooks/auth.ts). Checking the status code allowlist here previously
  // missed 202, so `res.json()` threw "Unexpected end of JSON input" and the
  // enumeration-safe confirmation never rendered. Read as text and only parse
  // JSON if something was actually sent, so any current or future bodyless
  // status works without having to be enumerated here.
  const text = await res.text();
  if (text.length === 0) return schema.parse(undefined);

  const json = JSON.parse(text);
  const parsed = schema.safeParse(json);
  if (!parsed.success) {
    // A contract drift is a bug worth seeing loudly in dev, not a silent
    // render of undefined fields.
    console.error(`[api] ${path} did not match the expected shape`, parsed.error.issues);
    throw new ApiError(500, "The API returned data in an unexpected shape.", parsed.error.issues);
  }
  return parsed.data;
}

/** Every hook goes through here. */
export async function request<T>(path: string, schema: z.ZodType<T>, opts: RequestOptions = {}): Promise<T> {
  if (USE_FIXTURES) {
    const { fixtureRequest } = await import("./fixtures");
    return fixtureRequest<T>(path, schema, opts);
  }
  return rawRequest(path, schema, opts);
}
