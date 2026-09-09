#!/usr/bin/env node
/*
 * Coverage-delta guard (issue #355). Fails a TEST-ONLY PR that increases covered
 * lines in NO file — i.e. a tautological test that asserts nothing real. Passes:
 * non-test-only PRs (out of scope), a missing baseline (first run), or a test-only
 * PR that raises covered lines in >=1 file.
 *
 * Usage: node scripts/coverage-delta.mjs --pr <summary> --baseline <summary> --base <ref>
 */
import { readFileSync, existsSync } from "node:fs";
import { execSync } from "node:child_process";

const arg = (name, def) => {
  const i = process.argv.indexOf(name);
  return i !== -1 ? process.argv[i + 1] : def;
};
const prPath = arg("--pr", "coverage/coverage-summary.json");
const basePath = arg("--baseline", "baseline/coverage-summary.json");
const base = arg("--base", "origin/main");

const pass = (m) => {
  console.log(`PASS coverage-delta: ${m}`);
  process.exit(0);
};
const fail = (m) => {
  console.error(`FAIL coverage-delta: ${m}`);
  process.exit(1);
};

// 1. No baseline (first PR before any nightly, or download failed) -> PASS.
if (!existsSync(basePath)) pass(`no baseline artifact at ${basePath}; cannot compute a delta`);

// 2. Classify the PR. Only PURE test-only PRs are in scope for the guard.
const changed = execSync(`git diff --name-only ${base}...HEAD`, { encoding: "utf8" })
  .split("\n")
  .map((s) => s.trim())
  .filter(Boolean);
if (changed.length === 0) pass("no changed files detected");

const isTestOrSupport = (f) =>
  /\.test\.ts$/.test(f) ||
  /(^|\/)__(tests|fixtures|mocks)__\//.test(f) ||
  /\.md$/.test(f) ||
  /(^|\/)vitest\.config\.ts$/.test(f) ||
  f === "vitest.coverage.base.ts";

const nonTest = changed.filter((f) => !isTestOrSupport(f));
if (nonTest.length > 0) {
  pass(`PR changes ${nonTest.length} non-test file(s); the guard only applies to test-only PRs`);
}

// 3. Test-only PR: require a covered-lines increase in at least one file.
const pr = JSON.parse(readFileSync(prPath, "utf8"));
const baseline = JSON.parse(readFileSync(basePath, "utf8"));
const coveredLines = (summary, file) => summary[file]?.lines?.covered ?? 0;

const allFiles = new Set([
  ...Object.keys(pr).filter((k) => k !== "total"),
  ...Object.keys(baseline).filter((k) => k !== "total"),
]);

const improved = [];
for (const file of allFiles) {
  if (coveredLines(pr, file) > coveredLines(baseline, file)) {
    improved.push({ file, before: coveredLines(baseline, file), after: coveredLines(pr, file) });
  }
}

if (improved.length === 0) {
  fail(
    "test-only PR did not raise covered lines in ANY file (tautological test?). " +
      "Compared the PR coverage against the nightly baseline; no file's lines.covered increased.",
  );
}

console.log("Files with increased covered lines:");
for (const i of improved) console.log(`  ${i.file}: ${i.before} -> ${i.after}`);
pass(`test-only PR raised covered lines in ${improved.length} file(s)`);
