import { createHash, randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { Reflector } from "@nestjs/core";
import { ForbiddenException } from "@nestjs/common";
import type { ExecutionContext } from "@nestjs/common";
import { createDatabase, apiKeys, eq, workspaces, type Database } from "@snapurl/database";
import { AuthGuard, Scope } from "./auth.guard.js";

/* ============================================================
   API keys must fail CLOSED.

   The bug this pins: the guard only consulted a key's scopes when the route
   declared @Scope. A route without one therefore accepted any valid key,
   whatever it was granted — the absence of a decorator read as "unrestricted"
   rather than "outside the API surface". A key scoped [links:read] could read
   GET /members, which returns every member's email and 2FA state.

   API_SCOPES is a closed set covering links, analytics, domains and
   conversions; nothing in it grants members, workspaces, developers or
   bio-pages. So the oracle is not "which routes felt sensitive" — it is that a
   key may reach a route only when that route names a scope the key holds.

   Uses the real @Scope decorator and a real Reflector, because the thing under
   test is the wiring between them: a stubbed reflector would only assert that
   the stub returns what it was told to.

   Runs only when DATABASE_URL is set.
   ============================================================ */

const DATABASE_URL = process.env.DATABASE_URL;
const describeDb = DATABASE_URL ? describe : describe.skip;

/** Routes as the controllers declare them: one scoped, one not. */
class Routes {
  @Scope("links:read")
  scopedToLinksRead() {}

  @Scope("domains:write")
  scopedToDomainsWrite() {}

  /** Shaped like GET /members — no @Scope and no @Roles. */
  unscoped() {}
}

describeDb("AuthGuard — API key scope enforcement", () => {
  let handle: ReturnType<typeof createDatabase>;
  let db: Database;
  let guard: AuthGuard;
  let workspaceId: string;
  const rawKey = `snap_test_${randomUUID().replace(/-/g, "")}`;

  const contextFor = (handler: () => void): ExecutionContext =>
    ({
      switchToHttp: () => ({
        getRequest: () => ({ headers: { authorization: `Bearer ${rawKey}` } }),
      }),
      getHandler: () => handler,
      getClass: () => Routes,
    }) as unknown as ExecutionContext;

  beforeAll(async () => {
    handle = createDatabase({ url: DATABASE_URL!, max: 1 });
    db = handle.db;
    workspaceId = randomUUID();
    await db.insert(workspaces).values({ id: workspaceId, name: "scope-test", slug: `st-${Date.now()}` });
    await db.insert(apiKeys).values({
      id: randomUUID(),
      workspaceId,
      name: "scope-test key",
      keyPrefix: rawKey.slice(0, 12),
      keyLast4: rawKey.slice(-4),
      keyHash: createHash("sha256").update(rawKey).digest("hex"),
      // Deliberately narrow: this key was granted exactly one scope.
      scopes: ["links:read"],
    });

    // The token service is never reached on the API-key path (the credential
    // starts with snap_), so it does not need to be real here.
    guard = new AuthGuard(new Reflector(), {} as never, db);
  });

  afterAll(async () => {
    await db.delete(apiKeys).where(eq(apiKeys.workspaceId, workspaceId));
    await db.delete(workspaces).where(eq(workspaces.id, workspaceId));
    await handle?.close();
  });

  it("allows a route whose declared scope the key holds", async () => {
    await expect(guard.canActivate(contextFor(Routes.prototype.scopedToLinksRead))).resolves.toBe(true);
  });

  it("refuses a route whose declared scope the key does not hold", async () => {
    await expect(guard.canActivate(contextFor(Routes.prototype.scopedToDomainsWrite))).rejects.toBeInstanceOf(
      ForbiddenException,
    );
  });

  it("refuses a route that declares no scope at all", async () => {
    // The regression. Before the fix this resolved to true, which is how a
    // links:read key reached the member roster.
    await expect(guard.canActivate(contextFor(Routes.prototype.unscoped))).rejects.toBeInstanceOf(
      ForbiddenException,
    );
  });
});
