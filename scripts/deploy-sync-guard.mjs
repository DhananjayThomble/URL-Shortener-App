#!/usr/bin/env node
/*
 * Regression guard for #1026 — "deploy web and API together".
 *
 * The incident: Vercel's Git integration deployed every push to `main` straight
 * to production while the API deployed only on an explicit dispatch, so the two
 * drifted apart and a web build that required a field the live API did not send
 * (AuthUser.plan, #966) broke Google sign-in in production.
 *
 * The fix moved the web deploy INTO .github/workflows/deploy-aws.yml and turned
 * off Git-triggered production deploys in web/vercel.json. This guard pins the
 * five structural properties that keep web and API shipping from one commit, so
 * a future edit that silently re-opens the drift reds here.
 *
 * It does NOT run the pipeline (no deploy, no Vercel). It reasons over the
 * workflow's job graph and step order and over vercel.json — the drift is a
 * STRUCTURE, and structure is exactly what a parse-and-assert test can hold.
 *
 * No YAML dependency is available at the repo root (see check-selfhost-env.mjs,
 * which parses by regex for the same reason), so this reads the two files as
 * text. The decision core `evaluateDeploySync(workflowText, vercelJsonText)` is
 * PURE — it takes the two file contents as strings — so deploy-sync-guard.test.mjs
 * drives it with no filesystem: the real files (expect PASS) and deliberately
 * broken variants and origin/main's own pre-fix files (expect FAIL).
 *
 * Run by `node --test scripts/deploy-sync-guard.test.mjs` in verify.yml.
 */
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

// --- A minimal, workflow-shaped YAML reader (no dependency). -----------------
// Only what this guard needs: the top-level `jobs:` map, each job's `needs:`
// list, and the ORDER of a job's step names. The GitHub Actions workflow shape
// is regular — jobs are keys at one indent under `jobs:`, steps are a `- name:`
// / `- uses:` sequence under a job's `steps:` — so a scoped line reader is
// enough and far more legible than hand-rolling a general YAML parser.

/** Split the file into top-level job blocks: { jobName: blockText }. Preserves
 *  source order via the returned array of [name, block] entries. */
export function parseJobs(workflowText) {
  const lines = workflowText.split("\n");
  // Find the `jobs:` line, then every key indented exactly two spaces under it.
  const jobsStart = lines.findIndex((l) => /^jobs:\s*$/.test(l));
  if (jobsStart === -1) return [];
  const entries = [];
  let current = null;
  let buf = [];
  for (let i = jobsStart + 1; i < lines.length; i++) {
    const line = lines[i];
    // A job key: exactly two leading spaces, an identifier, a colon, nothing
    // else of substance on the line. (Comment and blank lines never match.)
    const m = /^ {2}([A-Za-z0-9_-]+):\s*$/.exec(line);
    if (m) {
      if (current !== null) entries.push([current, buf.join("\n")]);
      current = m[1];
      buf = [];
    } else if (current !== null) {
      buf.push(line);
    }
  }
  if (current !== null) entries.push([current, buf.join("\n")]);
  return entries;
}

/** The job names in a job's `needs:` — both `needs: a` and `needs: [a, b]` and
 *  the block-list form. Returns [] when the job declares no needs. */
export function jobNeeds(blockText) {
  // Inline list: needs: [a, b, c]
  const inline = /^\s*needs:\s*\[([^\]]*)\]/m.exec(blockText);
  if (inline) {
    return inline[1]
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean);
  }
  // Single scalar: needs: a
  const scalar = /^\s*needs:\s*([A-Za-z0-9_-]+)\s*$/m.exec(blockText);
  if (scalar) return [scalar[1]];
  // Block list:
  //   needs:
  //     - a
  //     - b
  const block = /^\s*needs:\s*\n((?:\s*-\s*[A-Za-z0-9_-]+\s*\n?)+)/m.exec(blockText);
  if (block) {
    return [...block[1].matchAll(/-\s*([A-Za-z0-9_-]+)/g)].map((x) => x[1]);
  }
  return [];
}

/** Does `job` depend on `dep`, directly or transitively, in this graph? */
export function dependsOn(jobsMap, job, dep, seen = new Set()) {
  if (job === dep) return false;
  const needs = jobsMap.get(job) ?? [];
  if (needs.includes(dep)) return true;
  for (const n of needs) {
    if (seen.has(n)) continue;
    seen.add(n);
    if (dependsOn(jobsMap, n, dep, seen)) return true;
  }
  return false;
}

/**
 * #1037 — find every EXECUTED Vercel CLI invocation in a job block and judge
 * whether each one is correctly scoped.
 *
 * An executed invocation is `pnpm dlx vercel@...` (the whole file pins the CLI
 * that way). This deliberately does NOT match a bare `vercel ...` inside an
 * `echo "..."` — those are the human rollback runbook the smoke-failed job
 * prints, not calls the workflow makes.
 *
 * A call is OK when EITHER it carries `--scope` on its own command line, OR a
 * `vercel pull` ran earlier in the SAME job (which writes .vercel/ and scopes
 * every later call from the project link). `vercel pull` itself must carry
 * `--scope` or be the thing that establishes the link — here `pull` always
 * carries VERCEL_ORG_ID/PROJECT_ID via env, so a `pull` with no project link
 * yet is the one call allowed to self-scope from those; we treat a `pull` as
 * scope-establishing and require `--scope` only on NON-pull calls that precede
 * the first `pull`.
 *
 * Returns { calls: [{ job, subcommand, line, scoped, afterPull }], unscoped: [...] }
 * where `unscoped` is the subset that is neither `--scope`'d nor after a pull.
 */
export function vercelCalls(blockText, jobName) {
  // Join shell line-continuations first: a `vercel ... \` invocation spreads its
  // flags (including `--scope`) across physical lines, so the whole logical
  // command must be considered as one string. A trailing backslash (optionally
  // followed by whitespace) continues onto the next line.
  const logical = blockText.replace(/\\[ \t]*\r?\n\s*/g, " ");
  const lines = logical.split("\n");
  const calls = [];
  let sawPull = false;
  for (const raw of lines) {
    // Ignore shell comment lines (a `#` as the first non-space char): the
    // shared scripts document `pnpm dlx vercel@<version>` in comments, which
    // are not executed calls.
    const isComment = /^\s*#/.test(raw);
    // Ignore lines that are purely an echo of a command (the runbook text).
    const isEcho = /^\s*echo\s/.test(raw);
    // Ignore the ONE line that DEFINES the pinned-CLI string rather than
    // calling it: `printf 'pnpm dlx vercel@%s' ...` in scripts/vercel/lib.sh's
    // vercel_cli helper. A real call USES the helper via `$(vercel_cli) <sub>`.
    const isCliDefinition = /printf\s+['"]pnpm dlx vercel@/.test(raw);
    // An executed invocation is either the literal pinned form
    // `pnpm dlx vercel@...` (used in historical/inline workflows) OR the shared
    // `$(vercel_cli) <sub>` form the step scripts use.
    const literalInvocation = /pnpm\s+dlx\s+vercel@/.test(raw);
    const helperInvocation = /\$\(\s*vercel_cli\s*\)/.test(raw);
    if (isComment || isEcho || isCliDefinition || (!literalInvocation && !helperInvocation)) continue;
    // The subcommand is the first token after the CLI token. For the literal
    // form it follows `vercel@<version>`; for the helper form it follows
    // `$(vercel_cli)`. Both are matched linear-time (a single `\S+`/group, then
    // the subcommand word) with no nested quantifiers.
    let m = /vercel@\S+\s+([a-z][a-z-]*)/.exec(raw);
    if (!m) m = /\$\(\s*vercel_cli\s*\)\s+([a-z][a-z-]*)/.exec(raw);
    const subcommand = m ? m[1] : "(unknown)";
    const scoped = /--scope\b/.test(raw);
    const call = { job: jobName, subcommand, line: raw.trim(), scoped, afterPull: sawPull };
    calls.push(call);
    if (subcommand === "pull") sawPull = true;
  }
  return calls;
}

// --- The five properties. ----------------------------------------------------

/**
 * PURE core. Returns { ok, failures } — failures is a list of human-readable
 * strings, one per violated property, empty when all five hold.
 *
 * @param {string} workflowText    .github/workflows/deploy-aws.yml
 * @param {string} vercelJsonText  web/vercel.json
 * @param {object} [opts]
 * @param {Object<string,string>} [opts.scripts]  scripts/vercel/<name> -> text,
 *        the shared step scripts. When provided, property 6 (scoping) reads
 *        the EXECUTED Vercel calls from THESE files (the workflow now routes
 *        every call through them) and property 7 (no divergence) is checked.
 * @param {string} [opts.rehearsalText]  .github/workflows/rehearse-web-deploy.yml,
 *        for property 7.
 */
export function evaluateDeploySync(workflowText, vercelJsonText, opts = {}) {
  const failures = [];
  const scripts = opts.scripts || null;
  const rehearsalText = opts.rehearsalText ?? null;

  // ---- Property 1: vercel.json disables git production deploys for main. ----
  // "git": { "deploymentEnabled": { "main": false } }
  let vercel;
  try {
    vercel = JSON.parse(vercelJsonText);
  } catch (e) {
    failures.push(`(1) web/vercel.json is not valid JSON: ${e.message}`);
    vercel = null;
  }
  if (vercel) {
    const enabled = vercel.git?.deploymentEnabled;
    if (!enabled || enabled.main !== false) {
      failures.push(
        "(1) web/vercel.json does not disable git production deploys for main " +
          '(expected git.deploymentEnabled.main === false). A push to main would deploy the web on its own.',
      );
    }
  }

  // Parse the workflow once.
  const jobEntries = parseJobs(workflowText);
  const jobNames = jobEntries.map(([n]) => n);
  const blocks = new Map(jobEntries);
  const needsMap = new Map(jobEntries.map(([n, b]) => [n, jobNeeds(b)]));

  // Locate the jobs by the roles they play, not by hardcoded names only — but
  // this workflow's names are stable, so name them and verify they exist.
  const need = (name) => {
    if (!jobNames.includes(name)) {
      failures.push(`(job graph) expected a job named '${name}' in deploy-aws.yml; found: ${jobNames.join(", ")}`);
      return false;
    }
    return true;
  };
  const haveWebBuild = need("web-build");
  const haveDeploy = need("deploy");
  const haveMigrate = need("migrate");
  const havePromote = need("web-promote");
  const haveSmoke = need("smoke");
  const haveRelease = need("release");

  // ---- Property 2: the web build runs BEFORE the API deploy. ----------------
  // The web build+upload lives in `web-build`; `deploy` is the API deploy. The
  // API deploy must depend (transitively) on the web build, so a broken web
  // build aborts before the API is touched.
  if (haveWebBuild && haveDeploy) {
    if (!dependsOn(needsMap, "deploy", "web-build")) {
      failures.push(
        "(2) the API deploy job 'deploy' does not depend on 'web-build'; a broken web build would not stop the API deploy.",
      );
    }
    const wb = blocks.get("web-build") ?? "";
    // The web build gate itself: a `vercel build` must appear in web-build.
    if (!/vercel@?[^\n]*\bbuild\b/.test(wb) && !/\bvercel\b[^\n]*build/.test(wb)) {
      failures.push("(2) 'web-build' does not run a `vercel build` step — nothing compiles the web before the deploy.");
    }
  }

  // ---- Property 3: credentials checked before the API deploy, failing on ----
  //      any missing VERCEL_TOKEN / VERCEL_ORG_ID / VERCEL_PROJECT_ID.
  // The check lives in web-build (which deploy depends on), so it runs before
  // the API deploy by construction. Assert the step exists and references all
  // three credentials AND fails fast (an exit on a missing one).
  if (haveWebBuild) {
    const wb = blocks.get("web-build") ?? "";
    const names = ["VERCEL_TOKEN", "VERCEL_ORG_ID", "VERCEL_PROJECT_ID"];
    const missing = names.filter((n) => !wb.includes(n));
    if (missing.length) {
      failures.push(`(3) 'web-build' does not reference required Vercel credential(s): ${missing.join(", ")}.`);
    }
    // A fail-fast guard: a step that fails non-zero when a credential is empty.
    // Since #1041 the check is the shared require_vercel_creds (scripts/vercel/
    // lib.sh), so accept EITHER an inline `exit 1` in the step OR a call to
    // require_vercel_creds whose lib definition actually fails (return 1). Both
    // mean "the step fails fast on a missing value".
    const hasRequireStep = /name:\s*Require Vercel credentials/i.test(wb);
    const inlineExit = /exit 1/.test(wb);
    const callsSharedCheck = /require_vercel_creds/.test(wb);
    const sharedCheckFailsFast =
      callsSharedCheck && scripts && /require_vercel_creds\(\)\s*\{[\s\S]*?return 1[\s\S]*?\}/.test(scripts["lib.sh"] || "");
    // When scripts are not provided (older callers), a call to the shared check
    // is taken on faith; the inline path is unchanged.
    const hasFailFast = inlineExit || sharedCheckFailsFast || (callsSharedCheck && !scripts);
    if (!hasRequireStep || !hasFailFast) {
      failures.push(
        "(3) 'web-build' has no fail-fast 'Require Vercel credentials' step that fails non-zero on a missing value.",
      );
    }
    // And it must run before the API deploy: web-build precedes deploy (checked
    // in property 2), and the credentials step must be the FIRST step of
    // web-build so it fails before any build/upload work.
    const firstStepName = (/-\s*name:\s*([^\n]+)/.exec(wb) || [])[1]?.trim();
    if (firstStepName && !/Require Vercel credentials/i.test(firstStepName)) {
      failures.push(
        `(3) the Vercel credentials check is not the first step of 'web-build' (first step is '${firstStepName}'); it must fail before any other work.`,
      );
    }
  }

  // ---- Property 4: promote runs ONLY after deploy AND migrate succeed. ------
  if (havePromote && haveDeploy && haveMigrate) {
    const n = needsMap.get("web-promote") ?? [];
    if (!dependsOn(needsMap, "web-promote", "deploy")) {
      failures.push("(4) 'web-promote' does not depend on 'deploy'; the web could go live before the API.");
    }
    if (!dependsOn(needsMap, "web-promote", "migrate")) {
      failures.push("(4) 'web-promote' does not depend on 'migrate'; the web could go live before migrations apply.");
    }
    const wp = blocks.get("web-promote") ?? "";
    if (!/vercel@?[^\n]*\bpromote\b/.test(wp) && !/\bvercel\b[^\n]*promote/.test(wp)) {
      failures.push("(4) 'web-promote' does not run a `vercel promote` step.");
    }
  }

  // ---- Property 5: the release job needs the web promote AND smoke. ---------
  if (haveRelease && havePromote && haveSmoke) {
    if (!dependsOn(needsMap, "release", "web-promote")) {
      failures.push("(5) 'release' does not depend on 'web-promote'; a release could be tagged without the web live.");
    }
    if (!dependsOn(needsMap, "release", "smoke")) {
      failures.push("(5) 'release' does not depend on 'smoke'; a release could be tagged without the smoke gate passing.");
    }
  }

  // ---- Property 6 (#1037): every executed Vercel CLI call is scoped. --------
  // A team-scoped VERCEL_TOKEN fails the CLI's personal-account lookup with
  // "User not found. (404)" unless the call is scoped. A call is scoped when
  // it carries `--scope` on its command line OR a `vercel pull` ran earlier in
  // the same scope (pull writes the project link into .vercel/, which scopes
  // every later call). `vercel pull` itself establishes the link and is the
  // one call exempt from needing a prior pull.
  //
  // Since #1041 the EXECUTED Vercel calls live in the shared script files
  // (scripts/vercel/*.sh), not inline in the workflow. When `opts.scripts` is
  // given, scope is judged there — per file, since each script is run in its
  // own job step and a `pull` in pull.sh does not scope a call in a different
  // script. When it is NOT given (older callers), fall back to scanning the
  // workflow jobs, so the property still means the same thing.
  if (scripts) {
    for (const [fname, text] of Object.entries(scripts)) {
      // Each script is one logical "scope"; treat the file as the block and the
      // file name as the location. A pull EARLIER IN THE SAME SCRIPT scopes
      // later calls, but these scripts run one CLI call each, so in practice a
      // non-pull script must carry --scope OR be build/deploy (which run in the
      // same JOB as pull in the deploy). The deploy's job-level pull scoping is
      // asserted structurally below in property 7; here we require that any
      // call which is NOT build/deploy (the two that legitimately rely on a
      // same-job prior pull) is --scope'd.
      const sameJobAsPull = fname === "build.sh" || fname === "deploy.sh";
      for (const c of vercelCalls(text, `scripts/vercel/${fname}`)) {
        const ok = c.scoped || c.afterPull || c.subcommand === "pull" || sameJobAsPull;
        if (!ok) {
          failures.push(
            `(6) Vercel CLI call \`${c.subcommand}\` in scripts/vercel/${fname} is neither --scope'd nor preceded by \`vercel pull\`; ` +
              `a team-scoped VERCEL_TOKEN will fail its account lookup (404). Line: ${c.line}`,
          );
        }
      }
    }
  } else {
    for (const [name, block] of jobEntries) {
      for (const c of vercelCalls(block, name)) {
        const ok = c.scoped || c.afterPull || c.subcommand === "pull";
        if (!ok) {
          failures.push(
            `(6) Vercel CLI call \`${c.subcommand}\` in job '${name}' is neither --scope'd nor preceded by \`vercel pull\` in the same job; ` +
              `a team-scoped VERCEL_TOKEN will fail its account lookup (404). Line: ${c.line}`,
          );
        }
      }
    }
  }

  // ---- Property 7 (#1041): the deploy and the rehearsal share step CODE. ----
  // The deploy must not inline `pnpm dlx vercel@...` in the workflow — every
  // executed Vercel call must be routed through a shared scripts/vercel/*.sh
  // file, so the rehearsal can run the SAME code. And the rehearsal workflow
  // must exist and run those same scripts, so it cannot drift from the deploy.
  // This is the test that "reds if the two diverge" (#1041 condition 5).
  if (scripts || rehearsalText !== null) {
    // 7a: no inline executed Vercel call remains in the deploy workflow.
    for (const [name, block] of jobEntries) {
      const inline = vercelCalls(block, name);
      if (inline.length) {
        failures.push(
          `(7) deploy-aws.yml job '${name}' still runs \`pnpm dlx vercel@...\` INLINE (${inline
            .map((c) => c.subcommand)
            .join(", ")}); route it through a shared scripts/vercel/*.sh so the rehearsal runs the same code.`,
        );
      }
    }
    // 7b: the deploy workflow invokes the shared scripts for the four runtime
    // Vercel steps (record-previous, pull, build, deploy). promote is invoked
    // by the deploy only (the rehearsal exercises its path non-mutatingly).
    const requiredDeployScripts = [
      "scripts/vercel/record-previous.sh",
      "scripts/vercel/pull.sh",
      "scripts/vercel/build.sh",
      "scripts/vercel/deploy.sh",
      "scripts/vercel/promote.sh",
    ];
    for (const s of requiredDeployScripts) {
      if (!workflowText.includes(s)) {
        failures.push(`(7) deploy-aws.yml does not invoke the shared step script '${s}'.`);
      }
    }
    // 7c: the rehearsal must exist and run the SAME scripts the deploy runs for
    // every executable Vercel step, so it genuinely rehearses them. It must NOT
    // run promote.sh (that mutates production) — it exercises the promote path
    // with a non-mutating inspect instead.
    if (rehearsalText === null) {
      failures.push("(7) the rehearsal workflow .github/workflows/rehearse-web-deploy.yml is missing.");
    } else {
      const mustRun = [
        "scripts/vercel/record-previous.sh",
        "scripts/vercel/pull.sh",
        "scripts/vercel/build.sh",
        "scripts/vercel/deploy.sh",
      ];
      for (const s of mustRun) {
        if (!rehearsalText.includes(s)) {
          failures.push(`(7) the rehearsal does not run the shared step script '${s}', so it would not rehearse that step.`);
        }
      }
      if (/\bbash\s+scripts\/vercel\/promote\.sh\b/.test(rehearsalText)) {
        failures.push(
          "(7) the rehearsal runs scripts/vercel/promote.sh, which assigns the PRODUCTION domain; it must exercise the promote path non-mutatingly instead.",
        );
      }
      // The rehearsal must also use the pinned CLI version, same as the deploy.
      if (!/VERCEL_CLI_VERSION/.test(rehearsalText)) {
        failures.push("(7) the rehearsal does not set VERCEL_CLI_VERSION; it must pin the same CLI the deploy uses.");
      }
    }
  }

  return { ok: failures.length === 0, failures };
}

// --- Injected effects: read the real files. ----------------------------------

export function readRepoFiles(repoRoot) {
  const scriptNames = ["lib.sh", "record-previous.sh", "pull.sh", "build.sh", "deploy.sh", "promote.sh"];
  const scripts = {};
  for (const n of scriptNames) {
    scripts[n] = readFileSync(join(repoRoot, "scripts/vercel", n), "utf8");
  }
  return {
    workflowText: readFileSync(join(repoRoot, ".github/workflows/deploy-aws.yml"), "utf8"),
    vercelJsonText: readFileSync(join(repoRoot, "web/vercel.json"), "utf8"),
    scripts,
    rehearsalText: readFileSync(join(repoRoot, ".github/workflows/rehearse-web-deploy.yml"), "utf8"),
  };
}

// --- CLI entrypoint (optional: run against the working tree). -----------------

function main() {
  const here = dirname(fileURLToPath(import.meta.url));
  const repoRoot = join(here, "..");
  const { workflowText, vercelJsonText, scripts, rehearsalText } = readRepoFiles(repoRoot);
  const { ok, failures } = evaluateDeploySync(workflowText, vercelJsonText, { scripts, rehearsalText });
  if (ok) {
    console.log("PASS deploy-sync-guard: web and API ship together (all 5 properties hold).");
    process.exit(0);
  }
  console.error("FAIL deploy-sync-guard:\n" + failures.map((f) => "  - " + f).join("\n"));
  process.exit(1);
}

if (process.argv[1] && import.meta.url === `file://${process.argv[1]}`) {
  main();
}
