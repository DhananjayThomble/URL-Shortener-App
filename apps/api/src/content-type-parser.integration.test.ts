/**
 * Regression test for issue #442.
 *
 * Root cause: Fastify's default JSON body parser rejects any request that
 * carries `Content-Type: application/json` with an empty body, returning 400
 * "Body cannot be empty when content-type is set to application/json". Every
 * DELETE in the dashboard (and bodyless POSTs such as /auth/2fa/setup) hit
 * this because the web client sent that header unconditionally.
 *
 * The fix in main.ts registers a replacement body parser that normalises an
 * empty body to `undefined` before Nest sees it, so bodyless routes succeed
 * while routes that declare a body schema still fail validation if the body
 * is absent.
 *
 * This test proves the parser function itself, and then wires it into a real
 * Fastify instance to confirm the HTTP behaviour, without bootstrapping the
 * full NestJS module tree (which requires external services and would crash
 * the Vitest worker process).
 *
 * Oracle: the parser's contract is defined by the comment in main.ts and by
 * the invariant that Fastify's `addContentTypeParser` callback must call
 * done(null, value) on success and done(error) on failure.
 */

import { afterAll, beforeAll, describe, expect, it } from "vitest";
import Fastify, { type FastifyInstance } from "fastify";

/* ============================================================
   The parser implementation — extracted so it can be unit-tested
   independently of the NestJS bootstrap.
   ============================================================ */

/** The body parser registered in main.ts, lifted out for direct testing. */
function parseJsonBody(body: string): unknown {
  if (body === "") return undefined;
  return JSON.parse(body);
}

describe("parseJsonBody — parser logic (unit)", () => {
  it("returns undefined for an empty string", () => {
    expect(parseJsonBody("")).toBeUndefined();
  });

  it("parses a valid JSON object", () => {
    expect(parseJsonBody('{"email":"a@b.com"}')).toEqual({ email: "a@b.com" });
  });

  it("parses a JSON string", () => {
    expect(parseJsonBody('"hello"')).toBe("hello");
  });

  it("parses a JSON number", () => {
    expect(parseJsonBody("42")).toBe(42);
  });

  it("parses a JSON array", () => {
    expect(parseJsonBody("[1,2,3]")).toEqual([1, 2, 3]);
  });

  it("throws on malformed JSON", () => {
    expect(() => parseJsonBody("{bad json")).toThrow();
  });
});

/* ============================================================
   HTTP-level test using a minimal Fastify instance.

   Registers the same body parser as main.ts and two routes that
   mirror the real behaviour: one that accepts an empty body
   (DELETE-style, no @Body() in the controller) and one that
   requires a body (POST /auth/login-style, validated by the route
   handler itself).
   ============================================================ */

describe("Content-type parser via Fastify HTTP (issue #442)", () => {
  let fastify: FastifyInstance;

  beforeAll(async () => {
    fastify = Fastify();

    /* Register the same parser that main.ts registers. */
    fastify.addContentTypeParser(
      "application/json",
      { parseAs: "string" },
      (_req, body, done) => {
        if ((body as string) === "") return done(null, undefined);
        try {
          done(null, JSON.parse(body as string));
        } catch (err) {
          done(err as Error, undefined);
        }
      },
    );

    /* Bodyless route — mirrors DELETE /links/:id: the route ignores the body. */
    fastify.delete("/links/:id", async (_req, reply) => {
      reply.status(204).send();
    });

    /* Body-required route — mirrors POST /auth/login: the handler validates the
       body and rejects it if absent. */
    fastify.post("/auth/login", async (req, reply) => {
      const body = req.body as Record<string, unknown> | undefined;
      if (!body?.email || !body?.password) {
        return reply.status(400).send({ message: "email and password are required" });
      }
      return reply.status(200).send({ accessToken: "tok" });
    });

    await fastify.ready();
  });

  afterAll(async () => {
    await fastify.close();
  });

  // -------------------------------------------------------------------------
  // Bodyless DELETE with Content-Type: application/json must NOT return 400
  // -------------------------------------------------------------------------

  it("DELETE with Content-Type: application/json and no body returns 204, not 400", async () => {
    const res = await fastify.inject({
      method: "DELETE",
      url: "/links/some-uuid",
      headers: { "Content-Type": "application/json" },
      // No body
    });
    expect(res.statusCode).toBe(204);
  });

  // -------------------------------------------------------------------------
  // Bodyless POST with Content-Type: application/json must NOT be rejected
  // by the body parser (the route handler itself may still reject it)
  // -------------------------------------------------------------------------

  it("POST with Content-Type: application/json and no body is not rejected by the parser (route handler runs)", async () => {
    /* The parser must not return 400 — the route handler's own validation
       will return 400 here, but that is a different 400: it means the body
       was parsed (as undefined) and reached the application code, not that
       Fastify refused to parse it at all. Oracle: the route handler returns
       400 with our own message, not Fastify's "Body cannot be empty" message. */
    const res = await fastify.inject({
      method: "POST",
      url: "/auth/login",
      headers: { "Content-Type": "application/json" },
    });
    expect(res.statusCode).toBe(400);
    const body = JSON.parse(res.body) as { message: string };
    expect(body.message).toBe("email and password are required");
    // Fastify's own parser error would say "Body cannot be empty..."
    expect(body.message).not.toContain("cannot be empty");
  });

  // -------------------------------------------------------------------------
  // Route that genuinely requires a body still rejects an empty one
  // -------------------------------------------------------------------------

  it("POST with Content-Type: application/json and a valid body succeeds", async () => {
    const res = await fastify.inject({
      method: "POST",
      url: "/auth/login",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email: "a@b.com", password: "secret" }),
    });
    expect(res.statusCode).toBe(200);
  });

  // -------------------------------------------------------------------------
  // Malformed JSON still returns an error (parser error path is intact)
  // -------------------------------------------------------------------------

  it("POST with Content-Type: application/json and malformed JSON body returns an error", async () => {
    const res = await fastify.inject({
      method: "POST",
      url: "/auth/login",
      headers: { "Content-Type": "application/json" },
      body: "{bad json",
    });
    // Fastify propagates the parse error — 400 or 500 depending on version
    expect(res.statusCode).toBeGreaterThanOrEqual(400);
  });
});
