/**
 * #699 — how the web client enters a workspace, and how it notices that the
 * workspace changed underneath a tab.
 *
 * 1. Entering a workspace (switcher, or after accepting an invitation) must go
 *    through POST /auth/refresh with the target workspace — the only path that
 *    checks the refresh-token family for revocation. It used to POST
 *    /auth/workspace, which minted a fresh access token from an access token.
 * 2. A refresh that the API answers with a DIFFERENT workspace (the hinted
 *    membership is gone) must be announced, so the app shell drops data cached
 *    for the old workspace instead of showing it under the new one.
 *
 * Node environment: `window` is a minimal EventTarget with a Map-backed
 * localStorage, which is all client.ts touches.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const ACCESS = "snapurl.accessToken";
const REFRESH = "snapurl.refreshToken";
const A = "11111111-1111-4111-8111-111111111111";
const B = "22222222-2222-4222-8222-222222222222";

function jwt(wid: string) {
  const b64 = (o: unknown) => Buffer.from(JSON.stringify(o)).toString("base64url");
  return `${b64({ alg: "HS256" })}.${b64({ sub: "u1", wid, role: "owner" })}.sig`;
}

function fakeWindow() {
  const store = new Map<string, string>();
  const localStorage = {
    getItem: (k: string) => store.get(k) ?? null,
    setItem: (k: string, v: string) => void store.set(k, v),
    removeItem: (k: string) => void store.delete(k),
  };
  return Object.assign(new EventTarget(), { localStorage, store });
}

type Win = ReturnType<typeof fakeWindow>;
let win: Win;
const originalFixtureEnv = process.env.NEXT_PUBLIC_USE_FIXTURES;

beforeEach(() => {
  process.env.NEXT_PUBLIC_USE_FIXTURES = "false";
  vi.resetModules();
  win = fakeWindow();
  vi.stubGlobal("window", win);
  win.localStorage.setItem(ACCESS, jwt(A));
  win.localStorage.setItem(REFRESH, "refresh-1");
});

afterEach(() => {
  process.env.NEXT_PUBLIC_USE_FIXTURES = originalFixtureEnv;
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });

describe("enterWorkspace (#699)", () => {
  it("enters through POST /auth/refresh with the target workspace — never a token-from-token route", async () => {
    const fetchSpy = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValue(json(200, { accessToken: jwt(B), refreshToken: "refresh-2" }));
    const { enterWorkspace } = await import("./client");

    await enterWorkspace(B);

    expect(fetchSpy).toHaveBeenCalledTimes(1);
    const [url, init] = fetchSpy.mock.calls[0]!;
    expect(String(url)).toMatch(/\/auth\/refresh$/);
    expect(JSON.parse(String(init!.body))).toEqual({ refreshToken: "refresh-1", workspaceId: B });
    expect(win.localStorage.getItem(ACCESS)).toBe(jwt(B));
    expect(win.localStorage.getItem(REFRESH)).toBe("refresh-2");
  });

  it("refuses (404) when the API fell back to another workspace instead of the requested one", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(json(200, { accessToken: jwt(A), refreshToken: "refresh-2" }));
    const { enterWorkspace } = await import("./client");
    await expect(enterWorkspace(B)).rejects.toMatchObject({ status: 404 });
  });

  it("a revoked session cannot enter: 401 clears the tokens and rejects", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(json(401, { message: "Unauthorized" }));
    const { enterWorkspace } = await import("./client");
    await expect(enterWorkspace(B)).rejects.toMatchObject({ status: 401 });
    expect(win.localStorage.getItem(ACCESS)).toBeNull();
    expect(win.localStorage.getItem(REFRESH)).toBeNull();
  });
});

describe("transparent refresh announces a workspace change (#699)", () => {
  async function runExpiredRequest(refreshedWid: string) {
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockImplementation(async (input) => {
      const url = String(input);
      if (url.endsWith("/auth/refresh")) return json(200, { accessToken: jwt(refreshedWid), refreshToken: "refresh-2" });
      // First call 401s (expired), the retry succeeds.
      return fetchSpy.mock.calls.filter(([u]) => !String(u).endsWith("/auth/refresh")).length === 1
        ? json(401, {})
        : json(200, { ok: true });
    });
    const { request, WORKSPACE_CHANGED_EVENT } = await import("./client");
    const { z } = await import("zod");
    const seen: Array<{ from: string; to: string }> = [];
    win.addEventListener(WORKSPACE_CHANGED_EVENT, (e) => seen.push((e as CustomEvent).detail));
    await request("/links", z.object({ ok: z.boolean() }));
    const refreshBody = JSON.parse(
      String(fetchSpy.mock.calls.find(([u]) => String(u).endsWith("/auth/refresh"))![1]!.body),
    );
    return { seen, refreshBody };
  }

  it("fires when the refresh lands in a different workspace than the hinted one", async () => {
    const { seen, refreshBody } = await runExpiredRequest(B);
    expect(refreshBody).toEqual({ refreshToken: "refresh-1", workspaceId: A });
    expect(seen).toEqual([{ from: A, to: B }]);
  });

  it("stays silent when the refresh keeps the same workspace", async () => {
    const { seen } = await runExpiredRequest(A);
    expect(seen).toEqual([]);
  });
});

describe("workspaceIdOf", () => {
  it("reads the wid claim and tolerates junk", async () => {
    const { workspaceIdOf } = await import("./client");
    expect(workspaceIdOf(jwt(A))).toBe(A);
    expect(workspaceIdOf(null)).toBeUndefined();
    expect(workspaceIdOf("not.a.jwt")).toBeUndefined();
  });
});
