// #1025 — regression test: the web app's `vercel-build` must build every
// workspace package the web app depends on, because Vercel runs it from a clean
// checkout with no prior `pnpm build:packages`. Run by `node --test`.
//
// The decision core (missingVercelBuildDeps) is PURE, so the first cases drive
// it inline with the exact pre-fix and post-fix scripts. The last case reads
// the real web/package.json and the live workspace graph, so a future package
// the web app imports without `vercel-build` covering it reds this test too.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import {
  transitiveWorkspaceDeps,
  packagesBuiltByVercelBuild,
  missingVercelBuildDeps,
} from "./vercel-build-deps.mjs";

// The real dependency graph at the time of #1025: web -> contract, domain,
// telemetry; domain -> contract. Used by the pure-core cases below.
const GRAPH = {
  "snapurl-web": ["@snapurl/contract", "@snapurl/domain", "@snapurl/telemetry"],
  "@snapurl/domain": ["@snapurl/contract"],
  "@snapurl/contract": [],
  "@snapurl/telemetry": [],
};

const OLD_SCRIPT =
  "pnpm --filter @snapurl/contract build && pnpm --filter @snapurl/domain build && next build";
const NEW_SCRIPT = 'pnpm --filter "snapurl-web^..." build && next build';

test("transitiveWorkspaceDeps closes over the graph and excludes the root", () => {
  const deps = transitiveWorkspaceDeps("snapurl-web", GRAPH);
  assert.deepEqual(
    [...deps].sort(),
    ["@snapurl/contract", "@snapurl/domain", "@snapurl/telemetry"],
  );
  assert.ok(!deps.has("snapurl-web"), "the root is not its own dependency");
});

test("the pre-#1025 hand-kept script misses @snapurl/telemetry (the production break)", () => {
  const missing = missingVercelBuildDeps({
    webName: "snapurl-web",
    vercelBuild: OLD_SCRIPT,
    graph: GRAPH,
  });
  assert.deepEqual(missing, ["@snapurl/telemetry"]);
});

test("the derived `web^...` selector covers every workspace dep", () => {
  const built = packagesBuiltByVercelBuild(NEW_SCRIPT, "snapurl-web");
  assert.equal(built.derivedAll, true);
  const missing = missingVercelBuildDeps({
    webName: "snapurl-web",
    vercelBuild: NEW_SCRIPT,
    graph: GRAPH,
  });
  assert.deepEqual(missing, []);
});

test("a hand-kept list that adds a new package but forgets to build it is caught", () => {
  // Simulate the next regression: web gains @snapurl/cache but the list lags.
  const graph = { ...GRAPH, "snapurl-web": [...GRAPH["snapurl-web"], "@snapurl/cache"], "@snapurl/cache": [] };
  const missing = missingVercelBuildDeps({
    webName: "snapurl-web",
    vercelBuild:
      "pnpm --filter @snapurl/contract build && pnpm --filter @snapurl/domain build && pnpm --filter @snapurl/telemetry build && next build",
    graph,
  });
  assert.deepEqual(missing, ["@snapurl/cache"]);
});

test("the LIVE web/package.json vercel-build covers every workspace dep it declares", () => {
  const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "..");
  const readPkg = (p) => JSON.parse(readFileSync(p, "utf8"));

  // Map every workspace package directory to {name, workspaceDeps}.
  const pkgDirs = [
    "web",
    ...readdirSync(join(repoRoot, "packages")).map((d) => join("packages", d)),
    ...readdirSync(join(repoRoot, "apps")).map((d) => join("apps", d)),
  ];
  const graph = {};
  let webName = null;
  for (const rel of pkgDirs) {
    let pkg;
    try {
      pkg = readPkg(join(repoRoot, rel, "package.json"));
    } catch {
      continue; // not a package dir
    }
    const workspaceDeps = Object.entries(pkg.dependencies ?? {})
      .filter(([, spec]) => String(spec).startsWith("workspace:"))
      .map(([name]) => name);
    graph[pkg.name] = workspaceDeps;
    if (rel === "web") webName = pkg.name;
  }
  assert.ok(webName, "web/package.json must have a name");

  const webPkg = readPkg(join(repoRoot, "web", "package.json"));
  const missing = missingVercelBuildDeps({
    webName,
    vercelBuild: webPkg.scripts["vercel-build"],
    graph,
  });
  assert.deepEqual(
    missing,
    [],
    `vercel-build does not build: ${missing.join(", ")}. It must build every ` +
      `workspace package the web app depends on (Vercel has no prior build:packages).`,
  );
});
