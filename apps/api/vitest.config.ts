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
    // Bound the fork pool. Each api test file loads the full Nest app and (for
    // the many *.integration.test.ts) a Postgres connection, so vitest's default
    // of one fork per CPU core peaks high enough to OOM a CI runner — a worker
    // then dies mid-run ("Worker forks emitted error / Worker exited
    // unexpectedly") and fails the job even though every test passed. Capping the
    // concurrent forks keeps peak memory bounded; files still run in parallel up
    // to the cap, so the wall-clock cost is small. 2 is comfortably under the
    // runner's memory while keeping the suite parallel.
    pool: "forks",
    poolOptions: { forks: { maxForks: 2, minForks: 1 } },
    coverage,
  },
  // The source imports .js specifiers (NodeNext style) but the files are .ts.
  resolve: { extensions: [".ts", ".js", ".json"] },
});
