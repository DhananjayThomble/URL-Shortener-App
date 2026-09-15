/**
 * Regression test for issue #442 (web client side).
 *
 * Root cause: rawRequest() in client.ts set `Content-Type: application/json`
 * unconditionally, even on requests with no body (all DELETEs, bodyless
 * POSTs). Fastify's JSON parser then rejected those requests with 400.
 *
 * The fix: only add the Content-Type header when opts.body !== undefined.
 *
 * Oracle: the header object built inside rawRequest before it calls fetch.
 * We intercept fetch with a spy to capture the headers that were actually sent,
 * without needing a running API server.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { z } from "zod";

/* rawRequest is not exported; we test it through the exported `request` path.
   Fixtures must be off so the real rawRequest runs. */
const originalFixtureEnv = process.env.NEXT_PUBLIC_USE_FIXTURES;

beforeEach(() => {
  /* Ensure we never hit the fixtures branch */
  process.env.NEXT_PUBLIC_USE_FIXTURES = "false";
});

afterEach(() => {
  process.env.NEXT_PUBLIC_USE_FIXTURES = originalFixtureEnv;
  vi.restoreAllMocks();
});

/** Intercept the global fetch call and return a synthetic 204 response. */
function mockFetch204() {
  return vi.spyOn(globalThis, "fetch").mockResolvedValue(
    new Response(null, { status: 204 }),
  );
}

/** Intercept fetch and return a synthetic JSON response. */
function mockFetch200(body: unknown) {
  return vi.spyOn(globalThis, "fetch").mockResolvedValue(
    new Response(JSON.stringify(body), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    }),
  );
}

describe("rawRequest — Content-Type header (issue #442)", () => {
  it("omits Content-Type when there is no body (DELETE)", async () => {
    const fetchSpy = mockFetch204();

    /* Import lazily so each test gets a fresh module if needed; the spy on
       globalThis.fetch is in place before the call executes regardless. */
    const { request } = await import("./client");
    await request("/links/some-id", z.undefined(), { method: "DELETE" }).catch(() => {});

    expect(fetchSpy).toHaveBeenCalledOnce();
    const [, init] = fetchSpy.mock.calls[0]!;
    const headers = init?.headers as Record<string, string> | undefined;
    expect(headers?.["Content-Type"]).toBeUndefined();
  });

  it("omits Content-Type when there is no body (POST without body)", async () => {
    const fetchSpy = mockFetch200({ otpSecret: "TOTP_SECRET", qrDataUrl: "data:..." });

    const { request } = await import("./client");
    await request("/auth/2fa/setup", z.object({ otpSecret: z.string(), qrDataUrl: z.string() }), {
      method: "POST",
    }).catch(() => {});

    expect(fetchSpy).toHaveBeenCalledOnce();
    const [, init] = fetchSpy.mock.calls[0]!;
    const headers = init?.headers as Record<string, string> | undefined;
    expect(headers?.["Content-Type"]).toBeUndefined();
  });

  it("sets Content-Type: application/json when a body is present (POST with body)", async () => {
    const fetchSpy = mockFetch200({ accessToken: "tok", refreshToken: "ref" });

    const { request } = await import("./client");
    await request(
      "/auth/login",
      z.object({ accessToken: z.string(), refreshToken: z.string() }),
      { method: "POST", body: { email: "a@b.com", password: "secret" } },
    ).catch(() => {});

    expect(fetchSpy).toHaveBeenCalledOnce();
    const [, init] = fetchSpy.mock.calls[0]!;
    const headers = init?.headers as Record<string, string> | undefined;
    expect(headers?.["Content-Type"]).toBe("application/json");
  });

  it("sets Content-Type: application/json when a body is present (PATCH with body)", async () => {
    const fetchSpy = mockFetch200({ id: "link-1" });

    const { request } = await import("./client");
    await request(
      "/links/link-1",
      z.object({ id: z.string() }),
      { method: "PATCH", body: { destination: "https://example.com" } },
    ).catch(() => {});

    expect(fetchSpy).toHaveBeenCalledOnce();
    const [, init] = fetchSpy.mock.calls[0]!;
    const headers = init?.headers as Record<string, string> | undefined;
    expect(headers?.["Content-Type"]).toBe("application/json");
  });
});
