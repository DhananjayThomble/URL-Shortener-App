import { test as base, type Page } from "@playwright/test";
import {
  createRealLink,
  registerRealUser,
  seedSessionTokens,
  type RealSession,
} from "../support/real-session";

/* ============================================================
   Issue #884 — make the a11y suite throttle-safe.

   The a11y audits (color-contrast-audit.spec.ts #558, label-audit.spec.ts
   #459) scan rendered markup against the REAL staging stack. Before this
   fixture every test registered its own throwaway account: each spec's
   `beforeEach` called `seedSession(page)`, which `installRealSession()`
   (playwright.a11y.config.ts) has patched to `seedRealSession` →
   `registerRealUser()` — one `POST /auth/register` PER TEST — and the two
   `/links/[id]` tests registered a second account directly. Across
   {light,dark} × {desktop,mobile} that is ~13 tests per combination, so one
   worker fired dozens of registrations.

   The register route has been throttled to 5/min per IP since 2026-10-17
   (apps/api/src/auth/auth.controller.ts `@Throttle({ default: { limit: 5,
   ttl: 60_000 } })`, #658). The audits were last touched on 2026-10-08, so the
   per-test registration cannot survive the throttle: the sixth test in any
   minute gets a 429 and the suite reds.

   The audits only READ the dashboard — they never mutate shared state in a way
   another test observes — so one workspace per worker is safe. This module
   provides two WORKER-SCOPED fixtures, registered once per Playwright worker
   process and shared by every test that worker runs:

     · `workerSession` — a RealSession registered once per worker. Tests seed
        it into their page with `seedSessionTokens` (via the `seedWorker`
        helper below) instead of calling the per-test `seedSession`.
     · `workerLink`    — one link created once per worker (as that worker's
        account) for the `/links/[id]` dynamic-route tests, which previously
        registered a SECOND account per test just to have a link to open.

   With both in place a worker makes exactly ONE `POST /auth/register`
   (registering `workerSession`), regardless of how many tests it runs — the
   count the issue's acceptance turns on. `registerRealUser()` additionally
   carries a bounded 429 back-off now, so even the one-per-worker sign-up is
   robust when several workers' first registrations collide in the same window.
   ============================================================ */

export interface A11yWorkerFixtures {
  /** A real account registered ONCE per worker and shared by every test. */
  workerSession: RealSession;
  /** One link created ONCE per worker, for the `/links/[id]` audits. */
  workerLink: { id: string };
}

// eslint-disable-next-line @typescript-eslint/ban-types
export const test = base.extend<{}, A11yWorkerFixtures>({
  workerSession: [
    async ({}, use) => {
      // Registered once per worker process. registerRealUser() already backs
      // off on a 429, so a cluster of workers starting together still succeeds.
      const session = await registerRealUser();
      await use(session);
    },
    { scope: "worker" },
  ],

  workerLink: [
    async ({ workerSession }, use) => {
      // Created as the worker's own account, once, for every /links/[id] test
      // this worker runs — no second registration, no per-test link creation.
      const link = await createRealLink(workerSession);
      await use(link);
    },
    { scope: "worker" },
  ],
});

/**
 * Seed the worker's shared session into a page before its first navigation.
 *
 * Drop-in replacement for the per-test `seedSession(page)` the audits used to
 * call in `beforeEach`: same contract (call before `page.goto`, because the
 * tokens go in via `addInitScript`), but it reuses the worker's single
 * registration instead of minting a fresh account.
 */
export async function seedWorker(page: Page, session: RealSession): Promise<void> {
  await seedSessionTokens(page, session);
}

export { expect } from "@playwright/test";
