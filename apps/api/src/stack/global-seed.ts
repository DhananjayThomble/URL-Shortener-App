/* Vitest globalSetup for the HTTP stack suites (spec: api-stack-tests).
 *
 * Seeds the nine principals (principals.ts) ONCE for the whole `test:stack`
 * run and hands them to every stack file through vitest's provide/inject
 * channel, then tears them down once when the run ends.
 *
 * Why this exists: `/auth/register` carries a 5/min-per-IP route throttle that
 * THROTTLE_LIMIT does NOT lift (it only raises the global throttler). Each
 * `seedPrincipals()` call registers five accounts; with per-file forks every
 * `*.stack.test.ts` used to seed its own set, so three files = fifteen
 * registers on one IP, which exhausts the window and 429s a later file's
 * `beforeAll` (reproduced deterministically; red on main's real-stack aux leg).
 * Seeding once removes the redundant registrations entirely — five registers
 * per run, comfortably under the window. (#893.)
 *
 * No stack, no work: when STACK_API_URL is unset the stack files all skip
 * (describeStack), so this setup seeds nothing and provides empty data — a
 * plain `pnpm test` without a running stack stays green and untouched.
 *
 * The provided value is the SERIALISABLE slice of the stack (SharedStackData):
 * principal auth headers + ids + workspace ids. The live `cleanup` closure
 * holds a DB handle and stays in THIS (main) process, invoked by the returned
 * teardown — it never crosses to the test forks.
 */
import type { TestProject } from "vitest/node";
import { seedPrincipals, type SeededStack, type SharedStackData } from "./principals.js";

const STACK_API_URL = process.env.STACK_API_URL;
const STACK_DATABASE_URL = process.env.STACK_DATABASE_URL;

/** Make the provided shape available to `inject("stackPrincipals")` with types. */
declare module "vitest" {
  export interface ProvidedContext {
    stackPrincipals: SharedStackData | null;
  }
}

export default async function setup(project: TestProject): Promise<() => Promise<void>> {
  // No running stack → the suites skip; seed nothing, provide a null marker.
  if (!STACK_API_URL) {
    project.provide("stackPrincipals", null);
    return async () => {
      /* nothing seeded */
    };
  }

  if (!STACK_DATABASE_URL) {
    throw new Error("STACK_DATABASE_URL is required for the stack suites (seeding roles and API keys).");
  }

  const stack: SeededStack = await seedPrincipals({ apiUrl: STACK_API_URL, databaseUrl: STACK_DATABASE_URL });

  project.provide("stackPrincipals", {
    principals: stack.principals,
    workspaceA: stack.workspaceA,
    workspaceB: stack.workspaceB,
  });

  // Teardown: drop the shared principals (and, by workspace cascade, every
  // per-file resource seeded against workspace A/B) exactly once.
  return async () => {
    await stack.cleanup();
  };
}
