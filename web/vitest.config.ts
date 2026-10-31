import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";
import { coverage } from "../vitest.coverage.base";

// web/ had zero tests (issue #351). Pure helpers (src/lib/utils.ts and future
// lib logic) run under the node environment; a component/DOM test opts into a
// DOM per file with a `// @vitest-environment happy-dom` pragma (happy-dom is
// the repo's DOM-test env — see apps/extension/vitest.config.ts) rather than
// flipping the global environment and slowing every pure test.
//
// `@/*` mirrors tsconfig's path alias so a test can import the same modules the
// app does; without it a test that reaches a component (which imports `@/...`)
// fails to resolve. Kept in lockstep with web/tsconfig.json `paths`.
export default defineConfig({
  test: { environment: "node", include: ["src/**/*.test.ts"], coverage },
  resolve: {
    alias: { "@": fileURLToPath(new URL("./src", import.meta.url)) },
  },
  // The app's .tsx uses the automatic JSX runtime (Next's default — no `React`
  // import in scope), so transform test-loaded JSX the same way instead of the
  // classic runtime that expects a global `React`.
  esbuild: { jsx: "automatic" },
});
