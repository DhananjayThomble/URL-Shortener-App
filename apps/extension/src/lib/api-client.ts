/* The extension's HTTP client for the SnapURL API.
 *
 * Requests and responses are validated against @snapurl/contract, the single
 * source of truth shared with the API and dashboard, so the extension can
 * never drift from the wire format. fetch is injected so the client is unit
 * testable without a network, and every failure mode the popup has to react to
 * (auth, rate limit, offline, validation) is surfaced as a distinct typed error.
 */

import {
  CreateLinkInput,
  Link,
  LinkList,
  ListLinksQuery,
  type Link as LinkType,
  type LinkList as LinkListType,
  type ListLinksQuery as ListLinksQueryType,
} from "@snapurl/contract";

import { hasCredentials, type Settings } from "./storage.js";

/** The API sets a global prefix of `api/v1`, so links live at `<base>/api/v1/links`. */
const API_PREFIX = "api/v1";

/** Base class so callers can `catch (e) { if (e instanceof ApiError) … }`. */
export class ApiError extends Error {
  readonly status: number | undefined;
  constructor(message: string, status?: number) {
    super(message);
    this.name = "ApiError";
    this.status = status;
  }
}

/** 401/403 — the API key is missing, wrong, or lacks the required scope. */
export class AuthError extends ApiError {
  constructor(message = "Your API key was rejected. Check it in the extension options.", status?: number) {
    super(message, status);
    this.name = "AuthError";
  }
}

/** 429 — too many requests; carries the server's retry hint when present. */
export class RateLimitError extends ApiError {
  readonly retryAfterSeconds: number | undefined;
  constructor(message = "You're going too fast. Try again in a moment.", retryAfterSeconds?: number) {
    super(message, 429);
    this.name = "RateLimitError";
    this.retryAfterSeconds = retryAfterSeconds;
  }
}

/** fetch threw — offline, DNS failure, CORS, or a bad base URL. */
export class NetworkError extends ApiError {
  constructor(message = "Couldn't reach the SnapURL API. Check your connection and the API base URL.") {
    super(message);
    this.name = "NetworkError";
  }
}

export type FetchImpl = typeof fetch;

export interface RequestOptions {
  /** Injected for testing; defaults to the global fetch. */
  fetchImpl?: FetchImpl;
  signal?: AbortSignal;
}

/** What the popup passes in; domain/slug are optional and defaulted from settings. */
export interface CreateLinkParams {
  destination: string;
  domain?: string;
  slug?: string;
}

function endpoint(settings: Settings): string {
  return `${settings.apiBaseUrl}/${API_PREFIX}/links`;
}

function authHeaders(settings: Settings): Record<string, string> {
  return { authorization: `Bearer ${settings.apiKey}`, "content-type": "application/json" };
}

function parseRetryAfter(response: Response): number | undefined {
  const raw = response.headers.get("retry-after");
  if (!raw) return undefined;
  const seconds = Number(raw);
  return Number.isFinite(seconds) ? seconds : undefined;
}

async function extractMessage(response: Response): Promise<string | undefined> {
  try {
    const data = (await response.clone().json()) as unknown;
    if (data && typeof data === "object") {
      const message = (data as { message?: unknown }).message;
      if (typeof message === "string") return message;
      if (Array.isArray(message)) return message.join(", ");
    }
  } catch {
    /* not JSON; fall through */
  }
  return undefined;
}

/** Turn a non-2xx response into the right typed error. */
async function toError(response: Response): Promise<ApiError> {
  const message = await extractMessage(response);
  if (response.status === 401 || response.status === 403) {
    return new AuthError(message, response.status);
  }
  if (response.status === 429) {
    return new RateLimitError(message, parseRetryAfter(response));
  }
  return new ApiError(message ?? `Request failed (${response.status}).`, response.status);
}

async function doFetch(url: string, init: RequestInit, fetchImpl: FetchImpl): Promise<Response> {
  try {
    return await fetchImpl(url, init);
  } catch {
    // fetch only throws on network-level failures; HTTP errors resolve normally.
    throw new NetworkError();
  }
}

/** POST a new link. Returns the parsed, contract-validated Link. */
export async function createLink(
  settings: Settings,
  params: CreateLinkParams,
  options: RequestOptions = {},
): Promise<LinkType> {
  if (!hasCredentials(settings)) {
    throw new AuthError("Add your SnapURL API key in the extension options first.");
  }
  const fetchImpl = options.fetchImpl ?? fetch;

  const body = CreateLinkInput.parse({
    destination: params.destination,
    domain: params.domain ?? settings.defaultDomain ?? "",
    ...(params.slug ? { slug: params.slug } : {}),
  });

  const init: RequestInit = {
    method: "POST",
    headers: authHeaders(settings),
    body: JSON.stringify(body),
  };
  if (options.signal) init.signal = options.signal;

  const response = await doFetch(endpoint(settings), init, fetchImpl);
  if (!response.ok) throw await toError(response);

  return Link.parse(await response.json());
}

/** GET recent links. Returns the parsed, contract-validated LinkList. */
export async function listLinks(
  settings: Settings,
  query: Partial<ListLinksQueryType> = {},
  options: RequestOptions = {},
): Promise<LinkListType> {
  if (!hasCredentials(settings)) {
    throw new AuthError("Add your SnapURL API key in the extension options first.");
  }
  const fetchImpl = options.fetchImpl ?? fetch;

  const parsedQuery = ListLinksQuery.parse(query);
  const search = new URLSearchParams();
  for (const [key, value] of Object.entries(parsedQuery)) {
    if (value !== undefined && value !== null) search.set(key, String(value));
  }
  const qs = search.toString();
  const url = qs ? `${endpoint(settings)}?${qs}` : endpoint(settings);

  const init: RequestInit = { method: "GET", headers: authHeaders(settings) };
  if (options.signal) init.signal = options.signal;

  const response = await doFetch(url, init, fetchImpl);
  if (!response.ok) throw await toError(response);

  return LinkList.parse(await response.json());
}
