import { defineConfig } from "vitest/config";

export default defineConfig({
  test: { environment: "node", include: ["src/**/*.test.ts"] },
  // The source imports .js specifiers (NodeNext style) but the files are .ts.
  resolve: { extensions: [".ts", ".js", ".json"] },
});
