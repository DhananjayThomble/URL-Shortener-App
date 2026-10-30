/* Stack-test environment (spec: api-stack-tests, design §2).
 *
 * The stack suites drive the BUILT API image over HTTP rather than booting
 * AppModule in-process: Vitest's esbuild transform drops `design:paramtypes`,
 * so Nest DI cannot construct the controllers
 * (`register-throttle.integration.test.ts:65-74`), and calling services
 * directly would skip the controller wiring that carries `actor.workspaceId`
 * down — the layer most likely to be wrong for authz.
 *
 * So these suites talk to a running stack (`pnpm staging:up`, api on :3001,
 * Postgres on :5435). They SKIP, rather than fail, when `STACK_API_URL` is
 * unset — the same shape as the `describeDb` convention the integration tests
 * use — so a plain `pnpm test` without a stack stays green. The parity guard
 * and the generator self-check need no stack and are named `*.test.ts`, not
 * `*.stack.test.ts`, so they run in the normal suite.
 */
import { describe } from "vitest";

/** Base URL of the running API, including the prefix, e.g.
 *  `http://localhost:3001/api/v1`. Unset means "no stack": the HTTP suites skip. */
export const STACK_API_URL = process.env.STACK_API_URL;

/** Direct Postgres connection used to seed roles and API keys the HTTP surface
 *  cannot create (a membership row with a given role, an apiKeys row with given
 *  scopes), and to clean up by id in `afterAll`. */
export const STACK_DATABASE_URL = process.env.STACK_DATABASE_URL;

/** Mirrors the `describeDb` convention: the HTTP suites run only when a stack
 *  URL is set, and are reported as skipped otherwise. */
export const describeStack = STACK_API_URL ? describe : describe.skip;

/** The API prefix the routes live under, derived from `STACK_API_URL` when it
 *  carries a path, else the app default (`config/env.ts:10`). Kept so a suite
 *  can build absolute paths without re-parsing the base URL. */
export const API_PREFIX = (() => {
  if (!STACK_API_URL) return "api/v1";
  try {
    const path = new URL(STACK_API_URL).pathname.replace(/^\/+|\/+$/g, "");
    return path || "api/v1";
  } catch {
    return "api/v1";
  }
})();
