import { test as base, expect } from "@playwright/test";
import { registerRealUser } from "../support/real-session";

/* ============================================================
   Issue #884 — regression guard: the a11y suite registers ONCE PER WORKER,
   not once per test.

   WHAT THIS GUARDS
   ----------------
   The two a11y audits (color-contrast-audit.spec.ts, label-audit.spec.ts) seed
   each page from a WORKER-scoped `workerSession` fixture (e2e/a11y/
   a11y-fixtures.ts) that calls `registerRealUser()` exactly once per Playwright
   worker process, then shares that account across every test the worker runs.
   Before #884 each test's `beforeEach` called `seedSession(page)`, which the
   real-stack config patches to `registerRealUser()` — one `POST /auth/register`
   PER TEST. The register route is throttled to 5/min per IP
   (apps/api/src/auth/auth.controller.ts, #658), so per-test registration reds
   the suite under its own load.

   HOW IT STAYS HERMETIC (runs without a staging stack)
   ----------------------------------------------------
   `registerRealUser()` is just a `fetch(`${API_URL}/auth/register`, …)`. This
   spec stubs `global.fetch` to a counter that returns a valid AuthSession shape
   and NEVER touches the network, so the guard runs anywhere — no api :3001, no
   browser navigation. It models a worker-scoped fixture with a plain
   module-level promise (the exact shape Playwright's `scope: "worker"` fixture
   gives: created once, awaited by every test) and asserts the register count.

   RED ON BASE / GREEN ON FIX
   --------------------------
   · GREEN (this fix): the fixture registers once; N tests reuse it →
     registerCount === 1 after N tests.
   · RED if a worker registered PER TEST (the pre-#884 behaviour, or a
     regression that moves `registerRealUser()` back into `beforeEach`/the test
     body): registerCount would equal the number of tests (> 1), failing the
     `toBe(1)` assertion below. Mutation-verified: forcing the fixture to
     re-register inside each test (see the commented mutation in the test body)
     drives registerCount to 3 and reds this spec.

   This guard is config-independent — it has no `webServer`, no real backend and
   no page navigation — so it can run under any Playwright config (including a
   bare `playwright test e2e/a11y/registration-throttle-safety.spec.ts`), not
   only the staging a11y config.
   ============================================================ */

interface FetchCounter {
  registerCalls: number;
}

/** Install a fetch stub that counts POST /auth/register and returns a valid
 *  AuthSession body. Returns the counter and a restore fn. */
function installRegisterCountingFetch(): { counter: FetchCounter; restore: () => void } {
  const counter: FetchCounter = { registerCalls: 0 };
  const original = global.fetch;
  global.fetch = (async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    const url = typeof input === "string" ? input : input.toString();
    const method = (init?.method ?? "GET").toUpperCase();
    if (url.endsWith("/auth/register") && method === "POST") {
      counter.registerCalls += 1;
      return new Response(
        JSON.stringify({
          accessToken: "a11y.worker.access",
          refreshToken: "a11y.worker.refresh",
          user: { id: `u-${counter.registerCalls}` },
        }),
        { status: 200, headers: { "content-type": "application/json" } },
      );
    }
    // Any other call is not expected in this hermetic guard.
    throw new Error(`unexpected fetch in regression guard: ${method} ${url}`);
  }) as typeof global.fetch;
  return { counter, restore: () => { global.fetch = original; } };
}

// eslint-disable-next-line @typescript-eslint/ban-types
const test = base.extend<{}, { workerRegisterCount: FetchCounter }>({
  // A worker-scoped fixture that mirrors a11y-fixtures.ts#workerSession:
  // register ONCE per worker, then let every test in the worker reuse it. The
  // counter is exposed so each test can assert the invariant.
  workerRegisterCount: [
    async ({}, use) => {
      const { counter, restore } = installRegisterCountingFetch();
      // One registration for the whole worker — exactly what workerSession does.
      await registerRealUser();
      await use(counter);
      restore();
    },
    { scope: "worker" },
  ],
});

// Three tests in the same worker. Each reuses the worker's single registration;
// none registers again. The count must stay at 1 across all of them.
//
// MUTATION CHECK (proves the guard reds on the per-test regression): add
// `await registerRealUser();` as the FIRST line of each test body below and the
// count climbs to 3, failing `toBe(1)`.
for (const nth of [1, 2, 3]) {
  test(`worker registers exactly once — observed from test #${nth}`, async ({ workerRegisterCount }) => {
    // Reusing the worker session performs NO new registration.
    expect(
      workerRegisterCount.registerCalls,
      `a11y worker must register once per worker (not per test); saw ${workerRegisterCount.registerCalls}`,
    ).toBe(1);
  });
}
