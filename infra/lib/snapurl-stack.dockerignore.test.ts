import { mkdtempSync, mkdirSync, rmSync, writeFileSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { IgnoreStrategy } from "aws-cdk-lib";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { LAMBDA_IMAGE_ASSET_EXCLUDES } from "./snapurl-stack.js";

/**
 * Oracle: `aws-cdk-lib`'s own `IgnoreStrategy.docker()` — the same ignore
 * engine `DockerImageCode.fromImageAsset` / `DockerImageAsset` drive
 * internally (`core/lib/asset-staging.ts` + `aws-ecr-assets/lib/image-asset.ts`
 * construct an `exclude` list of `[...dockerignoreLines, ...props.exclude,
 * "!.dockerignore"]` and hand it to `IgnoreStrategy.fromCopyOptions`, which
 * for Docker-mode assets is `IgnoreStrategy.docker`). This test reproduces
 * that exact merge against the repo's real root `.dockerignore` plus the
 * literal `LAMBDA_IMAGE_ASSET_EXCLUDES` list `imageFor()` in
 * `snapurl-stack.ts` actually passes as `exclude` — not a hand-written
 * reimplementation of dockerignore semantics, and not a copy of the
 * production exclude list (it is imported).
 *
 * This does not shell out to `cdk synth` / Docker: a full synth takes
 * ~45s locally (and needs AWS creds to get as far as asset staging), far
 * too slow for a unit test that runs on every `pnpm test`. Driving
 * `IgnoreStrategy` directly is the same code path CDK uses, just without the
 * CloudFormation template synthesis wrapped around it.
 */

// `pnpm test` / `vitest run` for this package always runs with cwd ==
// infra/ (see package.json's "test" script), so this resolves the same repo
// root regardless of module target. Avoids `import.meta.dirname` /
// `import.meta.url`, which `tsc --noEmit` rejects under this project's
// `module: "CommonJS"` (lib/**/*.ts, unlike functions/**/*.ts, is in
// tsconfig.json's `include` and so is subject to that check).
const REPO_ROOT = resolve(process.cwd(), "..");
const DOCKERIGNORE_PATH = join(REPO_ROOT, ".dockerignore");

/** Mirrors the merge in aws-ecr-assets' `DockerImageAsset` constructor:
 *  dockerignore lines first, then the construct's own `exclude`, then a
 *  trailing `!.dockerignore` so the ignore file itself is always re-included
 *  in the build context. */
function dockerAssetIgnorePatterns(exclude: string[]): string[] {
  const dockerignoreLines = readFileSync(DOCKERIGNORE_PATH, "utf8")
    .split("\n")
    .filter((line) => !!line);
  return [...dockerignoreLines, ...exclude, "!.dockerignore"];
}

describe("Lambda image asset dockerignore merge", () => {
  let assetRoot: string;

  beforeEach(() => {
    // A throwaway directory standing in for the repo root's asset-staging
    // source, with just enough real structure to exercise the patterns that
    // matter: a real tracked file under web/ (stand-in for web/.env.example)
    // and a nested local-only artifact directory (stand-in for
    // .qa-runs/<run>/.env.example).
    assetRoot = mkdtempSync(join(tmpdir(), "snapurl-dockerignore-"));
    mkdirSync(join(assetRoot, "web"), { recursive: true });
    writeFileSync(join(assetRoot, "web", ".env.example"), "WEB=1\n");
    mkdirSync(join(assetRoot, ".qa-runs", "some-run", "nested"), { recursive: true });
    writeFileSync(
      join(assetRoot, ".qa-runs", "some-run", "nested", ".env.example"),
      "LEAKED=1\n",
    );
  });

  afterEach(() => {
    rmSync(assetRoot, { recursive: true, force: true });
  });

  it("keeps the real web/.env.example and excludes the .qa-runs canary, with the production exclude list", () => {
    const patterns = dockerAssetIgnorePatterns(LAMBDA_IMAGE_ASSET_EXCLUDES);
    const strategy = IgnoreStrategy.docker(assetRoot, patterns);

    expect(strategy.ignores(join(assetRoot, "web", ".env.example"))).toBe(false);
    expect(
      strategy.ignores(join(assetRoot, ".qa-runs", "some-run", "nested", ".env.example")),
    ).toBe(true);
  });

  it("regresses (canary leaks back in) if the .qa-runs exclusion is removed from the production list", () => {
    const withoutQaRuns = LAMBDA_IMAGE_ASSET_EXCLUDES.filter((p) => p !== ".qa-runs");
    // Sanity: this test only means something if the production list actually
    // contains the entry being removed.
    expect(withoutQaRuns.length).toBe(LAMBDA_IMAGE_ASSET_EXCLUDES.length - 1);

    const patterns = dockerAssetIgnorePatterns(withoutQaRuns);
    const strategy = IgnoreStrategy.docker(assetRoot, patterns);

    // Same terminal `!**/.env.example` re-include in .dockerignore now wins
    // for the nested canary too, because nothing after it excludes .qa-runs.
    expect(
      strategy.ignores(join(assetRoot, ".qa-runs", "some-run", "nested", ".env.example")),
    ).toBe(false);
  });

  it("regresses if the exclude list is not repeated after .dockerignore at all", () => {
    // Only .dockerignore's own patterns, none of the asset-level excludes
    // imageFor() repeats after it. Demonstrates the ordering claim in the
    // code comment: .dockerignore alone is not enough, because its own
    // terminal `!**/.env.example` re-include runs after its own `.qa-runs`
    // exclusion and wins.
    const patterns = dockerAssetIgnorePatterns([]);
    const strategy = IgnoreStrategy.docker(assetRoot, patterns);

    expect(
      strategy.ignores(join(assetRoot, ".qa-runs", "some-run", "nested", ".env.example")),
    ).toBe(false);
  });

  it("still excludes cdk.out even though .dockerignore already lists it (belt-and-suspenders repeat)", () => {
    mkdirSync(join(assetRoot, "cdk.out", "asset.deadbeef"), { recursive: true });
    writeFileSync(join(assetRoot, "cdk.out", "asset.deadbeef", "marker.txt"), "x");

    const patterns = dockerAssetIgnorePatterns(LAMBDA_IMAGE_ASSET_EXCLUDES);
    const strategy = IgnoreStrategy.docker(assetRoot, patterns);

    expect(strategy.ignores(join(assetRoot, "cdk.out", "asset.deadbeef", "marker.txt"))).toBe(
      true,
    );
  });
});
