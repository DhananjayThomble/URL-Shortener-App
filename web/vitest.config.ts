import { defineConfig } from "vitest/config";
import { coverage } from "../vitest.coverage.base";

// web/ had zero tests (issue #351). Pure helpers (src/lib/utils.ts and future
// lib logic) run under the node environment; component/DOM tests can add
// jsdom/happy-dom later without changing this include.
export default defineConfig({ test: { environment: "node", include: ["src/**/*.test.ts"], coverage } });
