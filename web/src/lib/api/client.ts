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
    // Signed out in this tab: nothing on screen belongs to a workspace any more.
    renderedWorkspace = undefined;
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

/* Credential checks that are not under /auth/ literally or carry a slug, so the
   exact-match set above cannot hold them (#646). Both are called with
   `anonymous: true`: there is no session to have expired, so a 401 here only
   ever means "that credential is wrong". */
const ANONYMOUS_CREDENTIAL_PATH = /^\/(auth\/2fa\/verify|public\/links\/[^/]+\/unlock)$/;

/* POST /auth/2fa/disable is the odd one out: it is authenticated AND checks a
   password, so a 401 can mean either "wrong password" or "your access token
   expired". The API tells them apart only by message: the guard and a bare
   UnauthorizedException send these generic strings, the password check sends a
   specific one. Only a specific message counts as a credential rejection; the
   generic ones keep the existing refresh-and-retry and session-expired text. */
const CREDENTIAL_CHECK_WITH_SESSION = "/auth/2fa/disable";
const GENERIC_401_MESSAGES = new Set(["", "Unauthorized", "Sign in to continue."]);

function isCredentialRejection(path: string, message: string): boolean {
  if (AUTH_CREDENTIAL_PATHS.has(path) || ANONYMOUS_CREDENTIAL_PATH.test(path)) return true;
  return path === CREDENTIAL_CHECK_WITH_SESSION && !GENERIC_401_MESSAGES.has(message.trim());
}

function messageOf(detail: unknown, fallback: string): string {
  const d = detail as { message?: string | string[] } | null;
  if (Array.isArray(d?.message)) return d.message.join(", ");
  if (typeof d?.message === "string") return d.message;
  return fallback;
}

/** True when this 401 is the server rejecting a credential the person typed,
 *  so a refresh-and-retry cannot help and would only repeat the request. */
async function isCredentialRejectionResponse(res: Response, path: string): Promise<boolean> {
  try {
    return isCredentialRejection(path, messageOf(await res.clone().json(), ""));
  } catch {
    return isCredentialRejection(path, "");
  }
}

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
  if (res.status === 401 && !isCredentialRejection(path, message))
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

/* #699 — the workspace THIS tab's screen was rendered for. Per tab and in
   memory on purpose: localStorage is shared, so it cannot say what one tab is
   showing. Set from every GET /workspaces/current answer (the sidebar's data),
   and when this tab itself enters a workspace. */
let renderedWorkspace: string | undefined;

/** Record which workspace this tab's screen now shows. */
export function noteRenderedWorkspace(workspaceId: string | undefined) {
  renderedWorkspace = workspaceId;
}

/**
 * Compare the workspace on screen with the one the held access token is
 * bound to. On a mismatch, announce it (WorkspaceChangeGuard drops the cache
 * and routes to /links) and return true.
 *
 * Called after EVERY token change this tab can see: its own refreshes, a
 * storage event from another tab (including sign-out then sign-in, which
 * arrives as A → none, none → B), and before every workspace-scoped write.
 * `fallbackShown` is used only before the screen has loaded its workspace.
 */
export function checkWorkspaceCoherence(fallbackShown?: string): boolean {
  if (typeof window === "undefined") return false;
  const shown = renderedWorkspace ?? fallbackShown;
  const held = currentWorkspaceId();
  if (!shown || !held || shown === held) return false;
  window.dispatchEvent(new CustomEvent(WORKSPACE_CHANGED_EVENT, { detail: { from: shown, to: held } }));
  return true;
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
  if (ok) checkWorkspaceCoherence(before);
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
  const before = currentWorkspaceId();
  const { ok, ...rest } = await runRefresh(workspaceId);
  if (!ok) {
    const res = "res" in rest ? rest.res : undefined;
    if (!res || res.status === 401) tokens.clear();
    throw res ? await toApiError(res, "/auth/refresh") : new ApiError(401, "Your session has expired. Sign in again to continue.");
  }
  if (currentWorkspaceId() !== workspaceId) {
    // Refresh fell back: the membership is gone (removed meanwhile). The
    // token is now for a THIRD workspace, neither the one on screen nor the
    // one asked for — announce it before failing, or the screen stays on the
    // old workspace while every request goes to the fallback.
    checkWorkspaceCoherence(before);
    throw new ApiError(404, "You're no longer a member of that workspace.");
  }
  // The caller clears the cache and re-renders for this workspace.
  noteRenderedWorkspace(workspaceId);
}

async function rawRequest<T>(path: string, schema: z.ZodType<T>, opts: RequestOptions = {}, retry = true): Promise<T> {
  // #699 — never send a write with a token for a different workspace than the
  // one this tab is showing: it would save into a workspace the person cannot
  // see. Refuse, and let the guard move the screen to the real workspace.
  // /auth/* is user-scoped (sign-out, 2FA, accepting an invitation), not
  // workspace-scoped, so it is exempt.
  if ((opts.method ?? "GET") !== "GET" && !opts.anonymous && !path.startsWith("/auth/") && checkWorkspaceCoherence()) {
    throw new ApiError(
      409,
      "This tab was showing a different workspace, so nothing was saved. It has been reloaded — check and try again.",
    );
  }
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
  if (res.status === 401 && retry && !opts.anonymous && tokens.refresh && !(await isCredentialRejectionResponse(res, path))) {
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
