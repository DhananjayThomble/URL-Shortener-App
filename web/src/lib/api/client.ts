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

/** Turns a failed response into a message a person can act on. */
async function toApiError(res: Response): Promise<ApiError> {
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
  if (res.status === 401) message = "Your session has expired. Sign in again to continue.";
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

async function refreshSession(): Promise<boolean> {
  const refresh = tokens.refresh;
  if (!refresh) return false;
  refreshInFlight ??= (async () => {
    try {
      const res = await fetch(`${API_URL}/auth/refresh`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ refreshToken: refresh }),
      });
      if (!res.ok) return false;
      const data = (await res.json()) as { accessToken: string; refreshToken: string };
      tokens.set(data.accessToken, data.refreshToken);
      return true;
    } catch {
      return false;
    } finally {
      refreshInFlight = null;
    }
  })();
  return refreshInFlight;
}

async function rawRequest<T>(path: string, schema: z.ZodType<T>, opts: RequestOptions = {}, retry = true): Promise<T> {
  const headers: Record<string, string> = { "Content-Type": "application/json" };
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

  if (!res.ok) throw await toApiError(res);
  if (res.status === 204) return schema.parse(undefined);

  const json = await res.json();
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
