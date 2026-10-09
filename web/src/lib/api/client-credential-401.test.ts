/**
 * Issue #646 — follow-up to #437.
 *
 * #437 stopped a wrong-password 401 on seven /auth/* routes from being shown as
 * "Your session has expired". Three more credential checks still were:
 *   - POST /public/links/:slug/unlock   (anonymous visitor, no session at all)
 *   - POST /auth/2fa/verify             (sign-in challenge)
 *   - POST /auth/2fa/disable            (signed in; wrong password)
 * and the last one also ran a refresh-token rotation and a second POST for
 * what was only a wrong password.
 *
 * Node environment, same fake window as client-workspace.test.ts.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { z } from "zod";

const ACCESS = "snapurl.accessToken";
const REFRESH = "snapurl.refreshToken";
const SESSION_TEXT = "Your session has expired. Sign in again to continue.";

function fakeWindow() {
  const store = new Map<string, string>();
  const localStorage = {
    getItem: (k: string) => store.get(k) ?? null,
    setItem: (k: string, v: string) => void store.set(k, v),
    removeItem: (k: string) => void store.delete(k),
  };
  return Object.assign(new EventTarget(), { localStorage, store });
}

const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });

const originalFixtureEnv = process.env.NEXT_PUBLIC_USE_FIXTURES;

beforeEach(() => {
  process.env.NEXT_PUBLIC_USE_FIXTURES = "false";
  vi.resetModules();
  const win = fakeWindow();
  vi.stubGlobal("window", win);
  win.localStorage.setItem(ACCESS, "a.b.c");
  win.localStorage.setItem(REFRESH, "refresh-1");
});

afterEach(() => {
  process.env.NEXT_PUBLIC_USE_FIXTURES = originalFixtureEnv;
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

const calls = (spy: { mock: { calls: unknown[][] } }) =>
  spy.mock.calls.map(([u]) => String(u).replace(/^.*\/(?=auth|public)/, "/"));

describe("toApiError — credential checks added for #646", () => {
  async function err(path: string, message: string) {
    const { toApiError } = await import("./client");
    return toApiError(json(401, { message }), path);
  }

  it("link unlock: a wrong password shows the server message, not session text", async () => {
    const e = await err("/public/links/spring-sale/unlock", "That password isn't right.");
    expect(e.message).toBe("That password isn't right.");
  });

  it("2FA sign-in verify: shows the server message", async () => {
    const e = await err("/auth/2fa/verify", "That sign-in attempt timed out. Start again.");
    expect(e.message).toBe("That sign-in attempt timed out. Start again.");
  });

  it("2FA disable: a specific message is kept; a generic one still means session expired", async () => {
    expect((await err("/auth/2fa/disable", "That password isn't right.")).message).toBe("That password isn't right.");
    expect((await err("/auth/2fa/disable", "Unauthorized")).message).toBe(SESSION_TEXT);
    expect((await err("/auth/2fa/disable", "Sign in to continue.")).message).toBe(SESSION_TEXT);
  });

  it("the unlock matcher is exact: another route under /public is still session text", async () => {
    expect((await err("/public/links/spring-sale/report", "Unauthorized")).message).toBe(SESSION_TEXT);
    expect((await err("/public/links/a/b/unlock", "Unauthorized")).message).toBe(SESSION_TEXT);
  });
});

describe("request — no refresh-and-retry for a rejected credential (#646)", () => {
  it("2FA disable with a wrong password: one POST, no refresh, server message surfaces", async () => {
    const spy = vi.spyOn(globalThis, "fetch").mockResolvedValue(json(401, { message: "That password isn't right." }));
    const { request } = await import("./client");
    await expect(
      request("/auth/2fa/disable", z.undefined(), { method: "POST", body: { password: "wrong" } }),
    ).rejects.toMatchObject({ status: 401, message: "That password isn't right." });
    expect(calls(spy)).toEqual(["/auth/2fa/disable"]);
    // A wrong password must not sign the person out.
    expect(window.localStorage.getItem(REFRESH)).toBe("refresh-1");
  });

  it("2FA disable with an expired access token still refreshes and retries", async () => {
    let disableCalls = 0;
    const spy = vi.spyOn(globalThis, "fetch").mockImplementation(async (input) => {
      const url = String(input);
      if (url.endsWith("/auth/refresh")) return json(200, { accessToken: "n.e.w", refreshToken: "refresh-2" });
      disableCalls += 1;
      return disableCalls === 1 ? json(401, { message: "Unauthorized" }) : new Response(null, { status: 204 });
    });
    const { request } = await import("./client");
    await request("/auth/2fa/disable", z.undefined(), { method: "POST", body: { password: "right" } });
    expect(calls(spy)).toEqual(["/auth/2fa/disable", "/auth/refresh", "/auth/2fa/disable"]);
  });

  it("link unlock (anonymous): the server message surfaces after a single POST", async () => {
    const spy = vi.spyOn(globalThis, "fetch").mockResolvedValue(json(401, { message: "That password isn't right." }));
    const { request } = await import("./client");
    await expect(
      request("/public/links/spring-sale/unlock", z.unknown(), { method: "POST", body: { password: "x" }, anonymous: true }),
    ).rejects.toMatchObject({ status: 401, message: "That password isn't right." });
    expect(calls(spy)).toEqual(["/public/links/spring-sale/unlock"]);
  });
});
