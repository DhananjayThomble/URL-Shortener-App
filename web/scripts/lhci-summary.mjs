#!/usr/bin/env node
// Print the per-route median metrics from a Lighthouse CI run (#475).
//
// lhci writes a manifest.json into its output directory listing every run and
// flagging the representative (median) run per URL. We read that, pull the
// median run's JSON report for each URL, and print LCP, TBT, total script
// transfer bytes and the performance score — so the baseline is readable in
// the job log without downloading the artifact.
//
// Usage: node web/scripts/lhci-summary.mjs <lhci-output-dir>
import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";

const dir = process.argv[2] || ".lighthouseci";
const manifestPath = join(dir, "manifest.json");

if (!existsSync(manifestPath)) {
  console.error(`No manifest.json at ${manifestPath} — nothing to summarize.`);
  process.exit(0);
}

const manifest = JSON.parse(readFileSync(manifestPath, "utf8"));
const medianRuns = manifest.filter((entry) => entry.isRepresentativeRun);

const scriptBytes = (lhr) => {
  const items = lhr.audits?.["resource-summary"]?.details?.items ?? [];
  const script = items.find((i) => i.resourceType === "script");
  return script ? script.transferSize : null;
};
const ms = (lhr, audit) => lhr.audits?.[audit]?.numericValue ?? null;
const fmt = (v) => (v == null ? "n/a" : Math.round(v));

const rows = [];
for (const run of medianRuns) {
  const lhr = JSON.parse(readFileSync(run.jsonPath, "utf8"));
  const url = new URL(run.url).pathname;
  rows.push({
    route: url,
    lcp_ms: fmt(ms(lhr, "largest-contentful-paint")),
    tbt_ms: fmt(ms(lhr, "total-blocking-time")),
    script_bytes: scriptBytes(lhr) ?? "n/a",
    perf: lhr.categories?.performance?.score != null ? Math.round(lhr.categories.performance.score * 100) : "n/a",
  });
}

rows.sort((a, b) => a.route.localeCompare(b.route));

console.log("\n=== Lighthouse median baseline (per route) ===");
console.log("route\tLCP(ms)\tTBT(ms)\tscript(bytes)\tperf");
for (const r of rows) {
  console.log(`${r.route}\t${r.lcp_ms}\t${r.tbt_ms}\t${r.script_bytes}\t${r.perf}`);
}
console.log("");
