import { describe, expect, it } from "vitest";
import { JwtService } from "@nestjs/jwt";
import { UnauthorizedException } from "@nestjs/common";
import { TokenService } from "./token.service.js";
import type { Env } from "../config/env.js";
import type { Database } from "@snapurl/database";

/* ============================================================
   verifyAccessToken must map every rejected bearer credential to the same
   401 shape, regardless of *why* jsonwebtoken rejected it.

   Issue #535: a forged `alg=none` compact JWT was reported reaching the API
   as a 400 instead of a 401. TokenService.verifyAccessToken already wraps
   every jwt.verifyAsync failure — including a forged alg=none token, which
   jsonwebtoken rejects as "jwt signature is required" (JsonWebTokenError,
   not a distinct class) — in the same bare catch that produces
   UnauthorizedException. These tests pin that behaviour directly against
   TokenService, independent of transport, so a regression here fails before
   any HTTP-layer concern (header parsing, framing) can confound it.

   No DB is touched by verifyAccessToken, so a real TokenService is
   constructed with a stub DB — matching the pattern in
   email-verification.integration.test.ts — rather than mocking the method
   under test. */

const env = {
  JWT_ACCESS_SECRET: "test-access-secret",
  JWT_ACCESS_TTL: "15m",
  JWT_REFRESH_TTL_DAYS: 30,
} as unknown as Env;

function b64url(obj: unknown): string {
  return Buffer.from(JSON.stringify(obj)).toString("base64url");
}

describe("TokenService.verifyAccessToken", () => {
  const tokens = new TokenService({} as unknown as Database, env, new JwtService());

  it("rejects a forged alg=none token as 401, not 400", async () => {
    // The literal repro from issue #535: header declares alg=none, the
    // signature segment is empty, and the payload otherwise looks like a
    // legitimate AccessTokenClaims (owner role, arbitrary sub/wid).
    const header = b64url({ alg: "none", typ: "JWT" });
    const payload = b64url({ sub: "x", wid: "y", role: "owner", email: "e", iat: 1, exp: 9_999_999_999 });
    const forged = `${header}.${payload}.`;

    await expect(tokens.verifyAccessToken(forged)).rejects.toBeInstanceOf(UnauthorizedException);
  });

  it("rejects a syntactically malformed token as 401", async () => {
    await expect(tokens.verifyAccessToken("not.a.validtoken")).rejects.toBeInstanceOf(UnauthorizedException);
  });

  it("agrees on the same message for both rejection paths", async () => {
    // The two paths reject for different underlying jsonwebtoken reasons
    // (missing signature vs. invalid signature/shape) but must not leak
    // that distinction to the caller.
    const header = b64url({ alg: "none", typ: "JWT" });
    const payload = b64url({ sub: "x", wid: "y", role: "owner", email: "e", iat: 1, exp: 9_999_999_999 });
    const forged = `${header}.${payload}.`;

    const [forgedErr, malformedErr] = await Promise.all([
      tokens.verifyAccessToken(forged).catch((e) => e as UnauthorizedException),
      tokens.verifyAccessToken("not.a.validtoken").catch((e) => e as UnauthorizedException),
    ]);

    expect(forgedErr).toBeInstanceOf(UnauthorizedException);
    expect(malformedErr).toBeInstanceOf(UnauthorizedException);
    expect(forgedErr.getResponse()).toEqual(malformedErr.getResponse());
    expect(forgedErr.getStatus()).toBe(401);
  });

  it("still accepts a genuinely valid access token", async () => {
    // Guards the positive path so the two rejection tests above cannot pass
    // by accident of verifyAccessToken always throwing.
    const claims = { sub: "user-1", wid: "ws-1", role: "owner", email: "person@example.com" };
    const signed = await tokens.signAccessToken(claims);
    await expect(tokens.verifyAccessToken(signed)).resolves.toEqual(expect.objectContaining(claims));
  });
});
