/**
 * Regression test for issue #437.
 *
 * Root cause: toApiError() parsed the server's error message and then
 * unconditionally replaced it with "Your session has expired." for every 401,
 * including POST /auth/login with wrong credentials (no session ever existed).
 *
 * Oracle: packages/contract declares the shape; the session-expiry wording is
 * only correct when the caller held a token that the server rejected. On auth
 * credential routes (/auth/login, /auth/register, /auth/oauth, etc.) the
 * server's message is the authoritative signal and must reach the caller intact.
 */

import { describe, expect, it } from "vitest";
import { toApiError } from "./client";

/** Build a minimal Response whose json() returns the given body. */
function makeResponse(status: number, body: { message?: string | string[] } | null): Response {
  const bodyText = body === null ? "not-json!" : JSON.stringify(body);
  return new Response(bodyText, {
    status,
    statusText: status === 401 ? "Unauthorized" : "Forbidden",
    headers: { "Content-Type": body === null ? "text/plain" : "application/json" },
  });
}

// ---------------------------------------------------------------------------
// The core regression: auth routes must pass server messages through
// ---------------------------------------------------------------------------

describe("toApiError — 401 on auth credential routes", () => {
  const authRoutes = [
    "/auth/login",
    "/auth/register",
    "/auth/oauth",
    "/auth/password-reset/request",
    "/auth/password-reset/confirm",
    "/auth/email/verify",
    "/auth/email/resend",
  ];

  for (const path of authRoutes) {
    it(`${path}: preserves the server's message (not session-expiry text)`, async () => {
      const res = makeResponse(401, { message: "Invalid credentials" });
      const err = await toApiError(res, path);
      expect(err.status).toBe(401);
      expect(err.message).toBe("Invalid credentials");
      expect(err.message).not.toContain("session");
    });
  }

  it("/auth/login: preserves an array message joined with ', '", async () => {
    const res = makeResponse(401, { message: ["email must be valid", "password is required"] });
    const err = await toApiError(res, "/auth/login");
    expect(err.message).toBe("email must be valid, password is required");
    expect(err.message).not.toContain("session");
  });
});

// ---------------------------------------------------------------------------
// Authenticated routes: session-expiry wording must still apply
// ---------------------------------------------------------------------------

describe("toApiError — 401 on authenticated routes", () => {
  const authenticatedRoutes = [
    "/links",
    "/links/abc123",
    "/workspaces/ws1/members",
    "/analytics/clicks",
  ];

  for (const path of authenticatedRoutes) {
    it(`${path}: uses the session-expiry message`, async () => {
      const res = makeResponse(401, { message: "Unauthorized" });
      const err = await toApiError(res, path);
      expect(err.status).toBe(401);
      expect(err.message).toBe("Your session has expired. Sign in again to continue.");
    });
  }
});

// ---------------------------------------------------------------------------
// Non-JSON body: status text is the fallback on auth routes too
// ---------------------------------------------------------------------------

describe("toApiError — non-JSON body fallback", () => {
  it("/auth/login with non-JSON body falls back to status text", async () => {
    const res = makeResponse(401, null);
    const err = await toApiError(res, "/auth/login");
    expect(err.status).toBe(401);
    expect(err.message).toBe("Unauthorized");
    expect(err.message).not.toContain("session");
  });

  it("authenticated route with non-JSON body still shows session-expiry text", async () => {
    const res = makeResponse(401, null);
    const err = await toApiError(res, "/links");
    expect(err.message).toBe("Your session has expired. Sign in again to continue.");
  });
});

// ---------------------------------------------------------------------------
// 403 is unchanged — blanket message is correct everywhere (no credential route
// returns 403 for legitimate use; leave it alone per the brief)
// ---------------------------------------------------------------------------

describe("toApiError — 403 is unchanged", () => {
  it("403 always uses the permission-denied message regardless of path", async () => {
    const authRes = makeResponse(403, { message: "Forbidden" });
    const authErr = await toApiError(authRes, "/auth/login");
    expect(authErr.message).toBe("You don't have permission to do that.");

    const apiRes = makeResponse(403, { message: "Forbidden" });
    const apiErr = await toApiError(apiRes, "/links/abc");
    expect(apiErr.message).toBe("You don't have permission to do that.");
  });
});
