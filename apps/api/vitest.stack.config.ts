import { defineConfig } from "vitest/config";

/* Config for the HTTP stack suites (spec: api-stack-tests, H1).
 *
 * These drive the built API image over HTTP against the local staging stack,
 * so they are a SEPARATE, opt-in suite from the default `pnpm test`: run with
 * `pnpm --filter @snapurl/api test:stack` after `pnpm staging:up`, with
 * STACK_API_URL (and STACK_DATABASE_URL) set. They skip (describeStack) when
 * STACK_API_URL is unset. No coverage: these are end-to-end HTTP assertions,
 * not unit coverage of this package's source.
 */
export default defineConfig({
  test: {
    environment: "node",
    include: ["src/**/*.stack.test.ts"],
    // Seeding registers principals through the throttled auth routes with a
    // bounded back-off, so a single HTTP suite legitimately runs minutes.
    testTimeout: 120_000,
    hookTimeout: 120_000,
  },
  // The source imports .js specifiers (NodeNext style) but the files are .ts.
  resolve: { extensions: [".ts", ".js", ".json"] },
});
