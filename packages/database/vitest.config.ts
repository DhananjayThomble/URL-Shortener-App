import { defineConfig } from "vitest/config";
import { coverage } from "../../vitest.coverage.base";

export default defineConfig({
  test: { environment: "node", include: ["src/**/*.test.ts"], coverage },
});
