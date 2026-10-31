/*
 * Vitest setup for @snapurl/infra (#921).
 *
 * ROOT CAUSE of the flaky coverage leg: every `snapurl-stack.*.test.ts`
 * constructs the real SnapUrlStack, which eagerly stages three container-image
 * assets via `DockerImageCode.fromImageAsset(repoRoot, ...)`. CDK fingerprints
 * the ENTIRE monorepo `repoRoot` tree (honouring the exclude list) to compute
 * each asset hash — a single synchronous, event-loop-blocking operation that
 * measured ~55s per synth on a loaded runner (profiled: ~98% of the synth
 * wall-time is the stack constructor's asset fingerprint, not Template.fromStack).
 *
 * Why that caused the flake: vitest runs each file in a worker and the
 * worker<->main birpc `onTaskUpdate` call has a HARDWIRED 60s timeout (vitest
 * 3.2, every pool; not configurable and there is no main-thread pool). A synth
 * that blocks the worker's event loop for ~55-86s cannot service that RPC, so
 * `onTaskUpdate` times out at 60s and throws `[vitest-worker]: Timeout calling
 * "onTaskUpdate"` as an UNHANDLED error — failing the run even though every
 * assertion passes. When it aborts the coverage leg the v8 reporter gets no
 * data (`All files 0 0 0 0`) and pnpm surfaces ERR_PNPM_RECURSIVE_RUN_FIRST_FAIL.
 * It was intermittent because the synth time straddles the 60s boundary: fine
 * on an idle runner, over the edge under CI contention.
 *
 * THE FIX: set the standard CDK `aws:cdk:disable-asset-staging` context for
 * the test process via CDK_CONTEXT_JSON (read by every `new App()` through
 * App.readContextFromEnvironment, so no test file or stack-code edit is needed).
 * With staging disabled, CDK skips the repoRoot fingerprint walk: construct
 * time drops to ~17s — comfortably under the 60s RPC heartbeat, deterministically.
 *
 * Why this is safe (no behaviour change): disabling asset staging only changes
 * each asset's staged path/hash. NO assertion in any infra test inspects an
 * asset hash, ImageUri, S3Key or the functions' Code property — they assert on
 * CloudFormation resource properties (env vars, IAM grants, the cache-table
 * pairing, NAT strategy, etc.), which are identical either way. The full 8
 * files / 104 tests pass unchanged. The real `cdk synth`/`cdk deploy` path
 * (infra/bin via the CLI) never sets this context, so deploy staging is
 * untouched.
 */
if (!process.env.CDK_CONTEXT_JSON) {
  process.env.CDK_CONTEXT_JSON = JSON.stringify({
    "aws:cdk:disable-asset-staging": true,
  });
}
