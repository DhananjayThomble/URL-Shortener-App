#!/usr/bin/env node
/*
 * Merge every package's coverage/coverage-summary.json (pnpm -r runs each package
 * separately, so there are N of them) into one repo-wide coverage/coverage-summary.json
 * keyed by REPO-RELATIVE file path. Re-keying to repo-relative is what lets the
 * nightly baseline (built in one checkout dir) and a PR run (a different checkout
 * dir) be compared file-by-file. Run from the repo root. Issue #355.
 */
import { readFileSync, writeFileSync, mkdirSync, globSync } from "node:fs";
import { relative, resolve, join } from "node:path";

const ROOT = process.cwd();

const files = globSync("**/coverage/coverage-summary.json", { cwd: ROOT }).filter(
  (f) => !f.includes("node_modules") && f.replace(/\\/g, "/") !== "coverage/coverage-summary.json",
);

const merged = {}; // repoRelPath -> metrics

for (const f of files) {
  const json = JSON.parse(readFileSync(resolve(ROOT, f), "utf8"));
  for (const [key, metrics] of Object.entries(json)) {
    if (key === "total") continue; // recomputed below
    // v8 summary keys are absolute paths; re-key to repo-relative, POSIX slashes.
    const repoRel = relative(ROOT, key).split("\\").join("/");
    merged[repoRel] = metrics;
  }
}

const total = {};
for (const cat of ["lines", "statements", "functions", "branches"]) {
  let covered = 0;
  let totalN = 0;
  for (const m of Object.values(merged)) {
    covered += m[cat]?.covered ?? 0;
    totalN += m[cat]?.total ?? 0;
  }
  total[cat] = { covered, total: totalN, skipped: 0, pct: totalN ? +((covered / totalN) * 100).toFixed(2) : 100 };
}

mkdirSync(join(ROOT, "coverage"), { recursive: true });
writeFileSync(join(ROOT, "coverage", "coverage-summary.json"), JSON.stringify({ total, ...merged }, null, 2) + "\n");
console.log(`Merged ${files.length} package summaries -> coverage/coverage-summary.json (${Object.keys(merged).length} files)`);
