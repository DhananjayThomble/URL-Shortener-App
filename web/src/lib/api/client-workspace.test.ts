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

/* #699 follow-up (review of #701, M1/M2): the comparison must be against the
   workspace the tab RENDERED, after every token change, and a write must never
   leave with a token for another workspace than the one on screen. */
describe("rendered-workspace coherence (#699)", () => {
  const C = "33333333-3333-4333-8333-333333333333";

  async function load() {
    const client = await import("./client");
    const seen: Array<{ from: string; to: string }> = [];
    win.addEventListener(client.WORKSPACE_CHANGED_EVENT, (e) => seen.push((e as CustomEvent).detail));
    return { ...client, seen };
  }

  it("sign-out then sign-in elsewhere (A → none → B) is a change for a tab that rendered A", async () => {
    const { noteRenderedWorkspace, checkWorkspaceCoherence, seen } = await load();
    noteRenderedWorkspace(A);
    win.localStorage.removeItem(ACCESS); // other tab: tokens.clear()
    expect(checkWorkspaceCoherence(A)).toBe(false); // no token yet — nothing to compare
    win.localStorage.setItem(ACCESS, jwt(B)); // other tab: tokens.set() after sign-in
    expect(checkWorkspaceCoherence(undefined)).toBe(true); // oldValue was null
    expect(seen).toEqual([{ from: A, to: B }]);
  });

  it("a same-workspace rotation stays silent", async () => {
    const { noteRenderedWorkspace, checkWorkspaceCoherence, seen } = await load();
    noteRenderedWorkspace(A);
    win.localStorage.setItem(ACCESS, jwt(A));
    expect(checkWorkspaceCoherence(A)).toBe(false);
    expect(seen).toEqual([]);
  });

  it("enterWorkspace that falls back to a third workspace announces it before throwing", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(json(200, { accessToken: jwt(C), refreshToken: "refresh-2" }));
    const { noteRenderedWorkspace, enterWorkspace, seen } = await load();
    noteRenderedWorkspace(A);
    await expect(enterWorkspace(B)).rejects.toMatchObject({ status: 404 });
    expect(seen).toEqual([{ from: A, to: C }]);
  });

  it("a successful enterWorkspace records the new workspace as rendered (no spurious change)", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(json(200, { accessToken: jwt(B), refreshToken: "refresh-2" }));
    const { noteRenderedWorkspace, enterWorkspace, checkWorkspaceCoherence, seen } = await load();
    noteRenderedWorkspace(A);
    await enterWorkspace(B);
    expect(checkWorkspaceCoherence()).toBe(false);
    expect(seen).toEqual([]);
  });

  it("refuses a workspace-scoped write whose token is for another workspace than the one on screen", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue(json(201, { ok: true }));
    const { noteRenderedWorkspace, request, seen } = await load();
    const { z } = await import("zod");
    noteRenderedWorkspace(A);
    win.localStorage.setItem(ACCESS, jwt(B));
    await expect(
      request("/links", z.object({ ok: z.boolean() }), { method: "POST", body: { url: "https://example.com" } }),
    ).rejects.toMatchObject({ status: 409 });
    expect(fetchSpy).not.toHaveBeenCalled();
    expect(seen).toEqual([{ from: A, to: B }]);
  });

  it("still sends reads, /auth/* and anonymous calls on a mismatch, and writes once coherent", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockImplementation(async () => json(200, { ok: true }));
    const { noteRenderedWorkspace, request } = await load();
    const { z } = await import("zod");
    const ok = z.object({ ok: z.boolean() });
    noteRenderedWorkspace(A);
    win.localStorage.setItem(ACCESS, jwt(B));
    await request("/workspaces/current", ok);
    await request("/auth/2fa/disable", ok, { method: "POST", body: {} });
    await request("/public/x", ok, { method: "POST", body: {}, anonymous: true });
    noteRenderedWorkspace(B);
    await request("/links", ok, { method: "POST", body: {} });
    expect(fetchSpy).toHaveBeenCalledTimes(4);
  });

  it("signing out in this tab forgets the rendered workspace", async () => {
    const { noteRenderedWorkspace, tokens, checkWorkspaceCoherence } = await load();
    noteRenderedWorkspace(A);
    tokens.clear();
    tokens.set(jwt(B), "refresh-2");
    expect(checkWorkspaceCoherence()).toBe(false);
  });
});
