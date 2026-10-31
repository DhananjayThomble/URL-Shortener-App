import { defineConfig } from "vitest/config";

/*
 * Vitest config used only by Stryker (packages/domain/stryker.config.json).
 *
 * Trimmed copy of vitest.config.ts with the `coverage` block removed: the
 * production config imports `../../vitest.coverage.base` from the repo root,
 * which Stryker's package-sandbox cannot resolve (see the PR notes). Coverage
 * is irrelevant to a mutation run, so it is simply omitted here.
 *
 * A single forked process is used for the test runner. Stryker activates one
 * mutant per run and the instrumented code reads it from globalThis, falling
 * back to the __STRYKER_ACTIVE_MUTANT__ env var; a single fork keeps the active
 * mutant visible to the code under test, where the default multi-worker thread
 * pool left some workers pinned to a stale active mutant (reporting mutants as
 * survived that the suite in fact kills).
 */
export default defineConfig({
  test: {
    environment: "node",
    include: ["src/**/*.test.ts"],
    pool: "forks",
    poolOptions: { forks: { singleFork: true } },
  },
});
