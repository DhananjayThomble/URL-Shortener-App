/* Principal smoke test (spec: api-stack-tests, design §4; issue #888 "Done when").
 *
 * Proves the seeding works end to end against the running stack: each of the
 * nine principals calls `GET /auth/me` and gets the status its credential
 * implies — a session role returns 200 and reports exactly that role, the
 * anonymous caller gets 401, and an API key gets 403 because `/auth/me` names
 * no `@Scope` and keys fail closed on scope-less routes (auth.guard.ts).
 *
 * This is the harness proving itself, not the access matrix (#891/#892): it
 * asserts the principals are what they claim to be, so the suites that layer on
 * top of them can trust the fixtures.
 *
 * Runs only against a live stack (describeStack). `pnpm staging:up`, then
 * `STACK_API_URL=... STACK_DATABASE_URL=... pnpm --filter @snapurl/api test:stack`.
 */
import { afterAll, beforeAll, expect, it } from "vitest";
import { describeStack, STACK_API_URL, STACK_DATABASE_URL } from "./env.js";
import { seedPrincipals, type PrincipalName, type SeededStack } from "./principals.js";

describeStack("seeded principals — GET /auth/me smoke (design §4)", () => {
  let stack: SeededStack;

  beforeAll(async () => {
    if (!STACK_DATABASE_URL) {
      throw new Error("STACK_DATABASE_URL is required for the stack suites (seeding roles and API keys).");
    }
    stack = await seedPrincipals({ apiUrl: STACK_API_URL!, databaseUrl: STACK_DATABASE_URL });
  });

  afterAll(async () => {
    await stack?.cleanup();
  });

  async function me(authorization: string | null): Promise<Response> {
    return fetch(`${STACK_API_URL}/auth/me`, {
      headers: authorization ? { authorization } : {},
    });
  }

  it("the anonymous principal gets 401", async () => {
    const res = await me(stack.principals.anon.authorization);
    expect(res.status).toBe(401);
  });

  const sessionRoles: PrincipalName[] = ["ownerA", "adminA", "editorA", "viewerA", "ownerB"];
  for (const name of sessionRoles) {
    it(`${name} gets 200 and reports role "${name.replace(/A$|B$/, "")}"`, async () => {
      const p = stack.principals[name];
      const res = await me(p.authorization);
      expect(res.status).toBe(200);
      const body = (await res.json()) as { role: string };
      expect(body.role).toBe(p.role);
    });
  }

  const apiKeys: PrincipalName[] = ["keyA-all", "keyA-links-read", "keyB-all"];
  for (const name of apiKeys) {
    it(`${name} gets 403 (no @Scope on /auth/me, keys fail closed)`, async () => {
      const res = await me(stack.principals[name].authorization);
      expect(res.status).toBe(403);
    });
  }
});
