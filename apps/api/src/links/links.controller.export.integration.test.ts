import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createDatabase, domains, eq, links, workspaces, type Database } from "@snapurl/database";
import { LinksController } from "./links.controller.js";
import { LinksService } from "./links.service.js";
import type { RequestActor } from "../auth/auth.guard.js";

/* ============================================================
   Issue #636: GET /links/export is reachable cross-origin (preflight
   succeeds), but the 200 response carried no `access-control-*` header, so
   the browser discarded it as a CORS failure.

   Root cause: the handler writes the response with `reply.raw.writeHead(...)`,
   which bypasses Fastify's reply pipeline entirely. @fastify/cors sets
   `Access-Control-Allow-Origin` via `reply.header(...)` in an `onRequest`
   hook (apps/api/src/main.ts registers it with `methods` including GET), so
   by the time the handler runs the header is sitting in `reply.getHeaders()`
   — but writeHead's own header object replaced it instead of merging it in.

   The fix spreads `reply.getHeaders()` into the writeHead call. This test
   stands in for the real cors plugin: it is unit-level (no HTTP server), so
   it fakes exactly what @fastify/cors does — call `reply.header(...)` before
   the handler body runs — using Fastify's real reply-header semantics
   (headers set, retrievable via getHeaders(), case-insensitively merged into
   whatever writeHead receives).

   Oracle: "every other API route returns access-control-allow-origin for
   WEB_ORIGIN" (issue body, and apps/api/src/main.ts's cors registration
   applied globally). The literal value asserted here is arbitrary and not
   the point — the point is that whatever reply.getHeaders() held survives
   into the writeHead call, which is the thing the raw.write bypass was
   dropping.

   Runs only when DATABASE_URL is set — see the note in rollup.test.ts.
   ============================================================ */

const DATABASE_URL = process.env.DATABASE_URL;
const describeDb = DATABASE_URL ? describe : describe.skip;

const safeBrowsingStub = {
  check: async () => ({ status: "clean" as const, checkedAt: new Date() }),
} as any;
const projectionNudgeStub = { nudge: () => {} } as any;
const cacheBustStub = { bust: async () => {} } as any;

/** Tracks exactly what the controller does to Fastify's raw response and its
 *  reply-level headers, without pulling in a real HTTP server or the real
 *  @fastify/cors plugin. `header()` + `getHeaders()` mirror Fastify's own
 *  reply API closely enough for this test's purpose: a case-insensitive
 *  header bag that writeHead's argument has to be merged with, not replaced
 *  by. */
function fakeReply() {
  const headers: Record<string, string> = {};
  const chunks: string[] = [];
  let headWritten: Record<string, string> | null = null;
  let ended = false;
  return {
    header(name: string, value: string) {
      headers[name.toLowerCase()] = value;
      return this;
    },
    getHeaders() {
      return { ...headers };
    },
    raw: {
      writeHead(_status: number, sentHeaders: Record<string, string>) {
        headWritten = sentHeaders;
      },
      write(chunk: string) {
        chunks.push(chunk);
      },
      end() {
        ended = true;
      },
    },
    _inspect: () => ({ headWritten, ended, chunks }),
  };
}

const actorFor = (workspaceId: string): RequestActor => ({
  userId: null,
  workspaceId,
  role: "viewer",
  email: "actor@example.com",
  label: "actor@example.com",
});

describeDb("LinksController.export CORS headers (#636)", () => {
  let handle: ReturnType<typeof createDatabase>;
  let db: Database;
  let controller: LinksController;
  let workspaceId: string;

  const stamp = Date.now();

  beforeAll(async () => {
    handle = createDatabase({ url: DATABASE_URL!, max: 1 });
    db = handle.db;
    controller = new LinksController(new LinksService(db, db, safeBrowsingStub, projectionNudgeStub, cacheBustStub));

    const [ws] = await db
      .insert(workspaces)
      .values({ name: "links export cors test", slug: `links-export-cors-${stamp}` })
      .returning({ id: workspaces.id });
    workspaceId = ws!.id;

    const [domain] = await db
      .insert(domains)
      .values({ workspaceId, domain: `links-export-cors-${stamp}.test`, isSystem: true, status: "live" })
      .returning({ id: domains.id });

    await db.insert(links).values({
      workspaceId,
      domainId: domain!.id,
      slug: `l${stamp}`,
      destination: "https://example.com",
      redirectType: 302,
      forwardQuery: false,
      deepLink: false,
      hideReferrer: false,
      publicPreview: false,
    });
  });

  afterAll(async () => {
    if (workspaceId) await db.delete(workspaces).where(eq(workspaces.id, workspaceId));
    await handle?.close();
  });

  it("forwards a CORS header already set on the reply into the raw writeHead call", async () => {
    const reply = fakeReply();
    // Standing in for @fastify/cors's onRequest hook, which has already run
    // and called reply.header(...) by the time the handler body executes.
    reply.header("Access-Control-Allow-Origin", "http://localhost:3000");
    reply.header("Vary", "Origin");

    await controller.export(actorFor(workspaceId), { limit: 50 } as never, reply as never);

    const { headWritten, ended, chunks } = reply._inspect();
    expect(headWritten).not.toBeNull();
    expect(headWritten!["access-control-allow-origin"]).toBe("http://localhost:3000");
    expect(headWritten!["vary"]).toBe("Origin");
    // The export's own headers must survive alongside the merged-in CORS ones.
    expect(headWritten!["Content-Type"]).toContain("text/csv");
    expect(ended).toBe(true);
    expect(chunks.length).toBeGreaterThan(0);
  });

  it("still streams a CSV when no CORS header is present on the reply (same-origin / curl)", async () => {
    const reply = fakeReply();
    await controller.export(actorFor(workspaceId), { limit: 50 } as never, reply as never);

    const { headWritten, chunks } = reply._inspect();
    expect(headWritten).not.toBeNull();
    expect(headWritten!["access-control-allow-origin"]).toBeUndefined();
    expect(chunks.join("")).toContain("short_url");
  });
});
