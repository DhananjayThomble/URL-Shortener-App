import { defineConfig } from "vitest/config";
import { coverage } from "../vitest.coverage.base";

export default defineConfig({
  test: {
    environment: "node",
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
    // is ~30-60s of blocking CPU, and two in parallel workers starve each
    // other past vitest's worker RPC timeout ("Timeout calling onTaskUpdate"),
    // failing the run with every assertion green.
    fileParallelism: false,
    coverage,
  },
});
