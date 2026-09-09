import { defineConfig } from "vitest/config";
import { coverage } from "../../vitest.coverage.base";

export default defineConfig({
  // happy-dom gives the pure lib tests a DOM (popup/options wiring lands in FEAT-004);
  // mirrors apps/api/vitest.config.ts which uses "node" for its server-only logic.
  test: { environment: "happy-dom", include: ["src/**/*.test.ts"], coverage },
  // The source imports .js specifiers (NodeNext style) but the files are .ts.
  resolve: { extensions: [".ts", ".js", ".json"] },
});
