import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "node",
    include: ["src/**/*.test.ts"],
    /* One database, so one file at a time.
     *
     * These suites run against a real Postgres rather than a fake, and they are
     * not isolated from each other by anything: rollupClicks drains every
     * unprocessed click in the database regardless of which workspace wrote it,
     * and partition maintenance takes locks on a table the other files insert
     * into. Run in parallel they produce two kinds of false result — a rollup
     * assertion that fails because another file's clicks were in the batch, and
     * an ATTACH PARTITION that deadlocks against a concurrent insert.
     *
     * Both were observed. Neither says anything about the code under test.
     * Serialising the files costs about a second and removes the whole class. */
    fileParallelism: false,
  },
});
