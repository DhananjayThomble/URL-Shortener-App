import { defineConfig } from "vitest/config";
import { coverage } from "../../vitest.coverage.base";

export default defineConfig({
  test: { environment: "node", include: ["src/**/*.test.ts"], coverage },
  // The source imports .js specifiers (NodeNext style) but the files are .ts.
  resolve: { extensions: [".ts", ".js", ".json"] },
});
