import { defineConfig } from "vitest/config";
import { coverage } from "../vitest.coverage.base";

export default defineConfig({
  test: {
    environment: "node",
    // The CDK stack's constructs are still validated by `cdk synth`, not
    // vitest — but lib/snapurl-stack.dockerignore.test.ts only imports a
    // plain exported string[] constant (LAMBDA_IMAGE_ASSET_EXCLUDES), not a
    // construct, so it is safe to include alongside functions/.
    include: ["functions/**/*.test.ts", "lib/**/*.test.ts"],
    coverage,
  },
});
