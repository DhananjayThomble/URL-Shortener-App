import { configDefaults, defineConfig } from "vitest/config";
import { coverage } from "../../vitest.coverage.base";

export default defineConfig({
  test: {
    environment: "node",
    include: ["src/**/*.test.ts"],
    // The HTTP stack suites carry their own config (vitest.stack.config.ts) and
    // run only against a live staging stack via `pnpm test:stack`. Without this
    // exclude the `src/**/*.test.ts` glob would also pick them up here and they
    // would skip (describeStack) rather than being a separate, opt-in suite.
    exclude: [...configDefaults.exclude, "src/**/*.stack.test.ts"],
    coverage,
  },
  // The source imports .js specifiers (NodeNext style) but the files are .ts.
  resolve: { extensions: [".ts", ".js", ".json"] },
});
