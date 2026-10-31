import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "node",
    // Disable the repoRoot asset-fingerprint walk for the test process (#921).
    // See vitest.setup.ts for the full root-cause writeup: this is what keeps
    // each CDK synth well under vitest's hardwired 60s worker-RPC heartbeat,
    // deterministically, with no change to any asserted template property.
    setupFiles: ["./vitest.setup.ts"],
    // The CDK stack's constructs are still validated by `cdk synth`, not
    // vitest. Two narrow exceptions are included directly because each only
    // imports a plain value/type, never a construct: lib/snapurl-stack.
    // dockerignore.test.ts imports the exported string[] constant
    // LAMBDA_IMAGE_ASSET_EXCLUDES, and bin/resolve-env.test.ts imports only
    // a type from aws-cdk-lib (#481).
    include: [
      "functions/**/*.test.ts",
      "lib/**/*.test.ts",
      "bin/**/*.test.ts",
    ],
    // One file at a time: each full stack synth (cache-bust, nat, nat-none)
    // is CPU-heavy blocking work, and two in parallel workers starve each
    // other past vitest's worker RPC timeout ("Timeout calling onTaskUpdate"),
    // failing the run with every assertion green.
    fileParallelism: false,
    // Uniform floor for the slow synth hooks (#921). Even with asset staging
    // disabled a synth is ~15-20s, and spikes on a loaded CI runner; the
    // per-file inline `beforeAll(..., 120_000)` budgets are the primary guard,
    // and this config-level floor is a backstop so any synth hook or test
    // added later without an explicit budget still clears the default 60s.
    // Not a retry and not a behaviour change — the synth always completes and
    // asserts the same thing; only the too-tight boundary was non-deterministic.
    hookTimeout: 180_000,
    testTimeout: 180_000,
    // No coverage for @snapurl/infra (#921). This package's first-party code
    // lives in lib/, bin/ and functions/, NOT src/, so the shared coverage
    // config's `include: ["src/**/*.ts"]` matches nothing: a COVERAGE=1 run
    // collects ZERO file-level data and only emits the empty `All files 0 0 0
    // 0` total — which scripts/merge-coverage.mjs drops anyway (it skips the
    // `total` key and sums per-file entries), so infra contributes nothing to
    // the merged baseline/PR summary either way. But the v8 instrumentation
    // added ~20s per synth, pushing the already-slow `beforeAll` deeper into
    // the hook-timeout danger zone. Disabling it removes pure dead weight and
    // a flake amplifier, with no change to any reported coverage number.
    coverage: { enabled: false },
  },
});
