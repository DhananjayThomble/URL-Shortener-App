import { defineConfig } from "vitest/config";
import { coverage } from "../vitest.coverage.base";

export default defineConfig({
  test: {
    environment: "node",
    // The CDK stack itself is validated by `cdk synth`, not vitest, so this
    // stays scoped away from lib/**. bin/resolve-env.ts is the one exception:
    // it imports only a type from aws-cdk-lib (no construct), so it is safe
    // to unit-test directly rather than only through a full synth (#481).
    include: ["functions/**/*.test.ts", "bin/**/*.test.ts"],
    coverage,
  },
});
