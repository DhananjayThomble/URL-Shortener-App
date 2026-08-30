import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "node",
    // Only the standalone CloudFront Function logic is unit-testable here (the
    // CDK stack itself is validated by `cdk synth`, not vitest). Keep the glob
    // scoped to functions/ so it never tries to import a construct file.
    include: ["functions/**/*.test.ts"],
  },
});
