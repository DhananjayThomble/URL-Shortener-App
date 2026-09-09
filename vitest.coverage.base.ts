/*
 * Shared coverage config (issue #355), imported by every package's
 * vitest.config.ts. Coverage activates only when COVERAGE=1 is in the env
 * (the `test:coverage` root script sets it), so the normal `pnpm test` inner
 * loop stays uninstrumented and fast.
 *
 * Why an env var, not `--coverage`: `pnpm -r test -- --coverage` does NOT forward
 * the flag to vitest (pnpm consumes args after `--` before the package script),
 * so `enabled` keyed on an env var is the reliable cross-workspace switch.
 *
 * Reporters: json-summary (the machine-readable coverage/coverage-summary.json
 * the delta check consumes) + text (a human summary in the run log).
 *
 * No `vitest` type import here: this file is imported by web/ too, whose tsconfig
 * does not resolve `vitest/config` for a file outside its own root. Each package's
 * defineConfig({ test: { coverage } }) type-checks the shape at its use site.
 */
export const coverage = {
  enabled: process.env.COVERAGE === "1",
  provider: "v8" as const,
  reporter: ["json-summary", "text"] as string[],
  reportsDirectory: "./coverage",
  // Only count first-party source; never count tests or fixtures as covered.
  include: ["src/**/*.ts"],
  exclude: ["src/**/*.test.ts", "src/**/*.d.ts", "src/**/__fixtures__/**", "src/**/__mocks__/**"],
  // Emit a summary even for packages with zero tests, so the merge step never
  // silently drops a package.
  all: true,
};
