import type { Page, Route } from "@playwright/test";

/* Browser-level stand-in for the SnapURL API, for the "mocked-api" lane
   (playwright.mocked-api.config.ts). Only specs that need the REAL API client use
   it; every reply copies a status code and message the NestJS API really sends
   (each spec cites the source line next to the reply).

   The web app under test is built with NEXT_PUBLIC_API_URL=<its own origin>/api/v1,
   so requests are same-origin and page.route sees them before any network. */

const TOKEN_KEY = "snapurl.accessToken";
const REFRESH_KEY = "snapurl.refreshToken";

export const API_PREFIX = "/api/v1";

export type MockReply = { status: number; body?: unknown };
export type MockRequest = { method: string; path: string; body: unknown };
export type MockHandler = (req: MockRequest, nth: number) => MockReply;

export type MockApi = {
  /** Every request seen, in order. */
  calls: MockRequest[];
  /** Calls to one endpoint, e.g. callsTo("POST", "/auth/refresh"). */
  callsTo(method: string, path: string): MockRequest[];
};

/** An access token the app can read a workspace id from (client.ts#workspaceIdOf). Not a real JWT. */
export function fakeAccessToken(workspaceId = "ws_mock"): string {
  const b64 = (o: object) => Buffer.from(JSON.stringify(o)).toString("base64url");
  return `${b64({ alg: "none" })}.${b64({ wid: workspaceId })}.sig`;
}

export const MOCK_USER = {
  id: "usr_mock",
  name: "Mock Owner",
  email: "owner@mock.test",
  initials: "MO",
  role: "owner",
} as const;

export const MOCK_WORKSPACE = {
  id: "ws_mock",
  name: "Mock Workspace",
  slug: "mock-workspace",
  initials: "MW",
  plan: "Growth",
  defaultDomain: "snap.to",
  defaultRedirect: "302",
  clicksUsed: 0,
  clicksIncluded: 1000000,
  retentionYears: 3,
  cookielessAnalytics: true,
  scanOnCreate: true,
  publicPreviews: true,
  currency: "INR",
} as const;

/** Seed a signed-in session before the app boots (same localStorage keys as support/session.ts). */
export async function seedMockSession(
  page: Page,
  access = fakeAccessToken(),
  refresh = "mock.refresh.token",
): Promise<void> {
  await page.addInitScript(
    ([tk, rk, a, r]) => {
      window.localStorage.setItem(tk, a);
      window.localStorage.setItem(rk, r);
    },
    [TOKEN_KEY, REFRESH_KEY, access, refresh] as const,
  );
}

/** Nest's default error body, which is what the API client reads `message` from. */
export const nestError = (status: number, message: string, error = "Unauthorized"): MockReply => ({
  status,
  body: { statusCode: status, message, error },
});

/**
 * Install handlers keyed "METHOD /path" (path relative to /api/v1, no query). A
 * handler is a fixed reply or a function of (request, nth call to that endpoint).
 * A request with no handler is answered 599 and kept in `calls`, so a spec fails
 * loudly instead of hanging.
 */
export async function mockApi(page: Page, handlers: Record<string, MockReply | MockHandler>): Promise<MockApi> {
  const calls: MockRequest[] = [];
  const counts = new Map<string, number>();

  await page.route(`**${API_PREFIX}/**`, async (route: Route) => {
    const req = route.request();
    const path = new URL(req.url()).pathname.slice(API_PREFIX.length);
    const method = req.method();
    let body: unknown = undefined;
    try {
      body = req.postDataJSON();
    } catch {
      /* no body, or not JSON */
    }
    const rec: MockRequest = { method, path, body };
    calls.push(rec);

    const key = `${method} ${path}`;
    const nth = (counts.get(key) ?? 0) + 1;
    counts.set(key, nth);
    const h = handlers[key];
    const reply: MockReply =
      h === undefined
        ? { status: 599, body: { message: `mock-api: no handler for ${key}` } }
        : typeof h === "function"
          ? h(rec, nth)
          : h;
    await route.fulfill({
      status: reply.status,
      contentType: "application/json",
      body: reply.body === undefined ? "" : JSON.stringify(reply.body),
    });
  });

  return {
    calls,
    callsTo: (method, path) => calls.filter((c) => c.method === method && c.path === path),
  };
}
