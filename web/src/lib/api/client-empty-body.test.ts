/**
 * Regression test for the review finding on PR #666 (issue #638).
 *
 * Root cause: rawRequest() in client.ts only skipped res.json() for a 204
 * status. POST /auth/password-reset/request and POST /auth/email/resend both
 * return 202 with an empty body (see apps/api/src/auth/auth.controller.ts —
 * @HttpCode(202), handler returns void) so that an enumeration attacker gets
 * the identical response for a known and an unknown email. Hitting res.json()
 * on that empty body threw "Unexpected end of JSON input" before the caller
 * ever saw a result, so the two account-recovery forms that depend on this
 * response (useRequestPasswordReset, useResendEmailVerification) could not
 * show their enumeration-safe confirmation against the real API.
 *
 * Oracle: apps/api/src/auth/auth.controller.ts declares @HttpCode(202) with a
 * void-returning handler for both routes — i.e. the API contract is "succeeds
 * with no body", not "succeeds with a 204". The web client must treat any
 * bodyless success response the same way regardless of which 2xx status
 * carries it.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { z } from "zod";

const originalFixtureEnv = process.env.NEXT_PUBLIC_USE_FIXTURES;

beforeEach(() => {
  process.env.NEXT_PUBLIC_USE_FIXTURES = "false";
});

afterEach(() => {
  process.env.NEXT_PUBLIC_USE_FIXTURES = originalFixtureEnv;
  vi.restoreAllMocks();
});

function mockFetchEmptyBody(status: number) {
  return vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response(null, { status }));
}

describe("rawRequest — bodyless success responses", () => {
  it("resolves a 202 with an empty body (POST /auth/password-reset/request)", async () => {
    mockFetchEmptyBody(202);

    const { request } = await import("./client");
    const result = await request("/auth/password-reset/request", z.undefined(), {
      method: "POST",
      body: { email: "a@b.com" },
      anonymous: true,
    });

    expect(result).toBeUndefined();
  });

  it("resolves a 202 with an empty body (POST /auth/email/resend)", async () => {
    mockFetchEmptyBody(202);

    const { request } = await import("./client");
    const result = await request("/auth/email/resend", z.undefined(), {
      method: "POST",
      body: { email: "a@b.com" },
      anonymous: true,
    });

    expect(result).toBeUndefined();
  });

  it("still resolves a 204 with an empty body (unaffected by the fix)", async () => {
    mockFetchEmptyBody(204);

    const { request } = await import("./client");
    const result = await request("/auth/logout", z.undefined(), {
      method: "POST",
      body: { refreshToken: "tok", allDevices: false },
      anonymous: true,
    });

    expect(result).toBeUndefined();
  });

  it("still parses a 200 response that does carry a JSON body", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(JSON.stringify({ accessToken: "tok" }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      }),
    );

    const { request } = await import("./client");
    const result = await request("/auth/refresh", z.object({ accessToken: z.string() }), {
      method: "POST",
      body: { refreshToken: "tok" },
      anonymous: true,
    });

    expect(result).toEqual({ accessToken: "tok" });
  });
});
