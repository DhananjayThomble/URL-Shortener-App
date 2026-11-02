#!/usr/bin/env node
/*
 * Regression guard for issue #1025 (spec: the Vercel production deploy).
 *
 * The web app's `vercel-build` runs on Vercel from a CLEAN checkout with NO
 * prior `pnpm build:packages`, so it must build every workspace package the web
 * app depends on by itself. #995 added a `@snapurl/telemetry` import to the web
 * app but left `vercel-build`'s hand-kept list at contract+domain, so telemetry
 * was never built and the production build broke on `Can't resolve
 * '@snapurl/telemetry/pure'`. CI didn't catch it because every CI job runs
 * `build:packages`, which builds every package.
 *
 * This module is a PURE decision core (no filesystem, no network): the full
 * workspace dependency graph and the parsed scripts are passed in, so the unit
 * test drives every case inline. `missingVercelBuildDeps` returns the workspace
 * packages the web app (transitively) depends on that `vercel-build` fails to
 * build before `next build` — empty means the guard passes.
 */

/**
 * The transitive closure of a package's workspace dependencies.
 *
 * @param {string} root  the package whose deps to close over (excluded from the result)
 * @param {Record<string, string[]>} graph  package name -> its direct workspace deps
 * @returns {Set<string>}  every workspace package `root` depends on, directly or transitively
 */
export function transitiveWorkspaceDeps(root, graph) {
  const seen = new Set();
  const walk = (name) => {
    for (const dep of graph[name] ?? []) {
      if (seen.has(dep)) continue;
      seen.add(dep);
      walk(dep);
    }
  };
  walk(root);
  return seen;
}

/**
 * The set of workspace packages a `vercel-build` script will actually build
 * before `next build`.
 *
 * Two shapes are recognised, matching how the script can be written:
 *  - A DERIVED selector `pnpm --filter "<webname>^..." build` (or `...^` with no
 *    quotes). `<name>^...` selects every dependency of `<name>` excluding itself,
 *    so by construction it covers the whole transitive closure — reported here as
 *    the special value "*" meaning "all deps, derived".
 *  - A HAND-KEPT list of `pnpm --filter <pkg> build` segments: only the packages
 *    literally named are built.
 *
 * @param {string} vercelBuild  the web package's `vercel-build` script
 * @param {string} webName  the web package's own name (for the `^...` selector)
 * @returns {{ derivedAll: boolean, named: Set<string> }}
 */
export function packagesBuiltByVercelBuild(vercelBuild, webName) {
  const named = new Set();
  // Derived selector: <webName>^... (the `^...` means "deps of, excluding self").
  // Accept optional surrounding quotes around the filter argument.
  const derivedRe = new RegExp(
    `--filter\\s+["']?${escapeRe(webName)}\\^\\.\\.\\.["']?`,
  );
  if (derivedRe.test(vercelBuild)) {
    return { derivedAll: true, named };
  }
  // Hand-kept list: each `--filter <pkg>` names one package built explicitly.
  const filterRe = /--filter\s+["']?(@?[\w./-]+)["']?/g;
  let m;
  while ((m = filterRe.exec(vercelBuild)) !== null) {
    named.add(m[1]);
  }
  return { derivedAll: false, named };
}

/**
 * PURE core: the workspace deps of the web app that `vercel-build` does NOT
 * build. Empty => the guard passes.
 *
 * @param {object} args
 * @param {string} args.webName  the web package's own name
 * @param {string} args.vercelBuild  its `vercel-build` script
 * @param {Record<string, string[]>} args.graph  package -> direct workspace deps
 * @returns {string[]}  sorted list of uncovered workspace deps
 */
export function missingVercelBuildDeps({ webName, vercelBuild, graph }) {
  const required = transitiveWorkspaceDeps(webName, graph);
  const built = packagesBuiltByVercelBuild(vercelBuild, webName);
  if (built.derivedAll) return []; // `^...` covers the whole closure by construction
  const missing = [...required].filter((dep) => !built.named.has(dep));
  return missing.sort();
}

function escapeRe(s) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
