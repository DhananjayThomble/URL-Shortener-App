import { configDefaults, defineConfig } from "vitest/config";
import { coverage } from "../../vitest.coverage.base";

export default defineConfig({
  test: {
    environment: "node",
    include: ["src/**/*.test.ts"],
    // The HTTP stack suites carry their own config (vitest.stack.config.ts) and
    // run only against a live staging stack via `pnpm test:stack`. Without this
    // exclude the `src/**/*.test.ts` glob would also pick them up here and they
    // would skip (describeStack) rather than being a separate, opt-in suite.
    exclude: [...configDefaults.exclude, "src/**/*.stack.test.ts"],
    // API-suite-only pool tuning for CI stability (NOT repo-wide, NOT singleFork).
    //
    // A fork worker was dying mid-run ("Worker forks emitted error / Worker
    // exited unexpectedly") and failing the job even though every test passed.
    // Root cause: vitest reuses a fork process across many test files, and this
    // suite's files each spin up a full Nest app (and, for the ~20
    // *.integration.test.ts, a Postgres pool) — closed in afterAll, but the
    // fork's V8 heap still grows file-over-file faster than GC reclaims it, and
    // a heavy property/fuzz file (src/stack/zod-arbitrary.test.ts, 145
    // fast-check cases) tips a worker past the default ~2 GB old-space ceiling
    // and it is killed. main is green at today's file count; #993 adds another
    // integration file, which is enough to cross the line.
    //
    // The cause-aligned fix is to give each fork worker more old-space headroom
    // (execArgv is applied to the fork child, not just the vitest parent) and to
    // cap concurrent forks so two heavy workers never peak together — the ubuntu
    // runner has the RAM for 2 × 3 GB. Scoped to this config file only, so no
    // other package's suite is affected.
    pool: "forks",
    poolOptions: { forks: { maxForks: 2, minForks: 1, execArgv: ["--max-old-space-size=3072"] } },
    coverage,
  },
  // The source imports .js specifiers (NodeNext style) but the files are .ts.
  resolve: { extensions: [".ts", ".js", ".json"] },
});
