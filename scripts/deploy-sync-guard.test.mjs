// Regression test for #1026 — "deploy web and API together", run by `node --test`.
//
// The guard's decision core `evaluateDeploySync(workflowText, vercelJsonText)`
// is PURE, so every case is driven here with no filesystem and no git:
//   - the REAL current files (the fix) -> PASS;
//   - origin/main's OWN pre-fix files, embedded as fixtures -> FAIL (the
//     red-on-broken proof: this exact test would have reded the incident);
//   - each property broken on its own -> FAIL, so no assertion is decorative.
//
// Why embedded fixtures rather than `git show origin/main:...` at test time:
// the pure-core convention in this repo (regression-test-guard.test.mjs,
// check-selfhost-env.test.mjs) is a hermetic unit test with no effects. The
// pre-fix snapshots below are the minimal shape origin/main actually had
// (verified against `git show origin/main:` when written): a deploy-aws.yml
// with no web jobs and a vercel.json with no deploymentEnabled.

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { evaluateDeploySync, parseJobs, jobNeeds, dependsOn, vercelCalls } from "./deploy-sync-guard.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = join(here, "..");
const read = (p) => readFileSync(join(repoRoot, p), "utf8");

// The shared step scripts + rehearsal, read once, so the live-file cases drive
// the full guard (properties 6 and 7 read these). The per-property fixtures
// below reuse them unchanged except where they deliberately break one.
function liveOpts() {
  const names = ["lib.sh", "record-previous.sh", "pull.sh", "build.sh", "deploy.sh", "promote.sh"];
  const scripts = Object.fromEntries(names.map((n) => [n, read(join("scripts/vercel", n))]));
  return { scripts, rehearsalText: read(".github/workflows/rehearse-web-deploy.yml") };
}

// --- The real, post-fix files. -----------------------------------------------

test("the live deploy-aws.yml + web/vercel.json PASS all properties", () => {
  const workflowText = read(".github/workflows/deploy-aws.yml");
  const vercelJsonText = read("web/vercel.json");
  const { ok, failures } = evaluateDeploySync(workflowText, vercelJsonText, liveOpts());
  assert.equal(ok, true, "expected the shipped files to pass; failures:\n" + failures.join("\n"));
  assert.deepEqual(failures, []);
});

// --- Red-on-broken: origin/main's OWN pre-fix files. -------------------------
// Minimal reproduction of the pre-#1026 files. A `main` push deployed the web
// (no deploymentEnabled), and deploy-aws.yml had no web build/promote jobs.

const PREFIX_VERCEL_JSON = `{
  "$schema": "https://openapi.vercel.sh/vercel.json",
  "framework": "nextjs",
  "ignoreCommand": "git diff --quiet HEAD^ HEAD -- :/web :/packages :/pnpm-lock.yaml"
}
`;

const PREFIX_WORKFLOW = `name: Deploy (AWS)
on:
  workflow_dispatch:
permissions:
  contents: read
jobs:
  plan:
    name: Plan (cdk diff)
    runs-on: ubuntu-24.04-arm
    steps:
      - run: echo plan
  deploy:
    name: Deploy
    needs: plan
    runs-on: ubuntu-24.04-arm
    steps:
      - run: echo deploy
  migrate:
    name: Apply DB migrations
    needs: deploy
    runs-on: ubuntu-latest
    steps:
      - run: echo migrate
  smoke:
    name: Post-deploy smoke
    needs: [deploy, migrate]
    uses: ./.github/workflows/smoke-deployed.yml
  release:
    name: GitHub Release
    needs: [plan, deploy, migrate, smoke]
    runs-on: ubuntu-latest
    steps:
      - run: echo release
`;

test("origin/main's pre-fix files FAIL (this test would have caught the #1026 incident)", () => {
  const { ok, failures } = evaluateDeploySync(PREFIX_WORKFLOW, PREFIX_VERCEL_JSON);
  assert.equal(ok, false, "pre-fix files must fail the guard");
  // Property 1 (vercel.json) and the missing web jobs must both be reported.
  assert.ok(
    failures.some((f) => f.startsWith("(1)")),
    "expected a property-1 failure (vercel.json does not disable main)",
  );
  assert.ok(
    failures.some((f) => /web-build/.test(f)),
    "expected a failure about the missing web-build job",
  );
});

// --- Each property broken on its own, from the real files. -------------------

function realFiles() {
  return {
    workflowText: read(".github/workflows/deploy-aws.yml"),
    vercelJsonText: read("web/vercel.json"),
  };
}

test("property 1 bites: vercel.json without deploymentEnabled.main=false FAILs", () => {
  const { workflowText } = realFiles();
  const broken = JSON.stringify({ $schema: "x", framework: "nextjs" });
  const { ok, failures } = evaluateDeploySync(workflowText, broken);
  assert.equal(ok, false);
  assert.ok(failures.some((f) => f.startsWith("(1)")));
});

test("property 2 bites: if deploy no longer needs web-build, FAIL", () => {
  const { workflowText, vercelJsonText } = realFiles();
  // Drop web-build from deploy's needs: make deploy need only plan.
  const broken = workflowText.replace(/needs:\s*\[plan,\s*web-build\]/, "needs: plan");
  assert.notEqual(broken, workflowText, "fixture edit must change the text");
  const { ok, failures } = evaluateDeploySync(broken, vercelJsonText);
  assert.equal(ok, false);
  assert.ok(failures.some((f) => f.startsWith("(2)")));
});

test("property 3 bites: removing the credentials check FAILs", () => {
  const { workflowText, vercelJsonText } = realFiles();
  // Rename the require step so the structural check for it fails.
  const broken = workflowText.replace(/Require Vercel credentials/g, "Something else entirely");
  assert.notEqual(broken, workflowText);
  const { ok, failures } = evaluateDeploySync(broken, vercelJsonText);
  assert.equal(ok, false);
  assert.ok(failures.some((f) => f.startsWith("(3)")));
});

test("property 4 bites: if web-promote no longer needs migrate, FAIL", () => {
  const { workflowText, vercelJsonText } = realFiles();
  const broken = workflowText.replace(
    "needs: [web-build, deploy, migrate]",
    "needs: [web-build, deploy]",
  );
  assert.notEqual(broken, workflowText, "fixture edit must change the text");
  const { ok, failures } = evaluateDeploySync(broken, vercelJsonText);
  assert.equal(ok, false);
  assert.ok(failures.some((f) => f.startsWith("(4)")));
});

test("property 5 bites: if release reaches web-promote through nothing, FAIL", () => {
  const { workflowText, vercelJsonText } = realFiles();
  // Release depends on web-promote directly AND transitively (via smoke, which
  // needs web-promote). To actually sever the dependency the fixture must drop
  // web-promote from BOTH release's and smoke's needs — which is the point:
  // the ordering is robust, held by two independent edges, so breaking one is
  // not enough. Breaking both must red the guard.
  const broken = workflowText
    .replace(
      "needs: [plan, web-build, deploy, migrate, web-promote, smoke]",
      "needs: [plan, web-build, deploy, migrate, smoke]",
    )
    .replace("needs: [deploy, migrate, web-promote]", "needs: [deploy, migrate]");
  assert.notEqual(broken, workflowText, "fixture edit must change the text");
  const { ok, failures } = evaluateDeploySync(broken, vercelJsonText);
  assert.equal(ok, false);
  assert.ok(
    failures.some((f) => f.startsWith("(5)")),
    "expected a property-5 failure; got:\n" + failures.join("\n"),
  );
});

test("property 5 bites: if release no longer needs smoke at all, FAIL", () => {
  const { workflowText, vercelJsonText } = realFiles();
  // Remove smoke from release's needs (and the transitive promote edge through
  // smoke is irrelevant to the smoke-gate requirement itself).
  const broken = workflowText.replace(
    "needs: [plan, web-build, deploy, migrate, web-promote, smoke]",
    "needs: [plan, web-build, deploy, migrate, web-promote]",
  );
  assert.notEqual(broken, workflowText, "fixture edit must change the text");
  const { ok, failures } = evaluateDeploySync(broken, vercelJsonText);
  assert.equal(ok, false);
  assert.ok(
    failures.some((f) => f.startsWith("(5)") && /smoke/.test(f)),
    "expected a property-5 smoke failure; got:\n" + failures.join("\n"),
  );
});

// --- Property 6 (#1037): every executed Vercel CLI call is scoped. -----------
// Since #1041 the executed calls live in scripts/vercel/*.sh, so scope is
// judged there (passed via opts.scripts).

test("property 6 holds on the real shared scripts (every Vercel call is scoped)", () => {
  const { workflowText, vercelJsonText } = realFiles();
  const { failures } = evaluateDeploySync(workflowText, vercelJsonText, liveOpts());
  assert.deepEqual(
    failures.filter((f) => f.startsWith("(6)")),
    [],
    "expected no property-6 failures on the shipped scripts",
  );
});

// --- Property 8 (#1041 fail 1): no user-lookup CLI command; REST for lookup/promote.

test("property 8 holds on the live scripts (no ls/inspect/promote CLI; REST used)", () => {
  const { workflowText, vercelJsonText } = realFiles();
  const { failures } = evaluateDeploySync(workflowText, vercelJsonText, liveOpts());
  assert.deepEqual(
    failures.filter((f) => f.startsWith("(8)")),
    [],
    "expected no property-8 failures on the shipped scripts",
  );
});

test("property 8 bites: a `vercel promote` CLI call reintroduced in promote.sh FAILs", () => {
  const { workflowText, vercelJsonText } = realFiles();
  const opts = liveOpts();
  // Replace the REST promote with the old user-lookup CLI call.
  const broken =
    opts.scripts["promote.sh"].replace(/vercel_api_post[\s\S]*/, "") +
    '\n$(vercel_cli) promote "$DEPLOYMENT_URL" --token "$VERCEL_TOKEN"\n';
  const { ok, failures } = evaluateDeploySync(workflowText, vercelJsonText, {
    ...opts,
    scripts: { ...opts.scripts, "promote.sh": broken },
  });
  assert.equal(ok, false);
  assert.ok(
    failures.some((f) => f.startsWith("(8)") && /promote/.test(f)),
    "expected a property-8 failure for the reintroduced CLI promote; got:\n" + failures.join("\n"),
  );
});

test("property 8 bites: record-previous.sh dropping the REST helper FAILs", () => {
  const { workflowText, vercelJsonText } = realFiles();
  const opts = liveOpts();
  const broken = opts.scripts["record-previous.sh"].replace(/vercel_api_get/g, "some_other_call");
  assert.notEqual(broken, opts.scripts["record-previous.sh"], "fixture edit must change the script");
  const { ok, failures } = evaluateDeploySync(workflowText, vercelJsonText, {
    ...opts,
    scripts: { ...opts.scripts, "record-previous.sh": broken },
  });
  assert.equal(ok, false);
  assert.ok(
    failures.some((f) => f.startsWith("(8)") && /record-previous/.test(f)),
    "expected a property-8 failure when the REST lookup helper is gone; got:\n" + failures.join("\n"),
  );
});

// --- Property 7 (#1041): deploy and rehearsal share step CODE. ---------------

test("property 7 holds on the live files (deploy routes through shared scripts, rehearsal runs them)", () => {
  const { workflowText, vercelJsonText } = realFiles();
  const { failures } = evaluateDeploySync(workflowText, vercelJsonText, liveOpts());
  assert.deepEqual(
    failures.filter((f) => f.startsWith("(7)")),
    [],
    "expected no property-7 failures on the shipped files",
  );
});

test("property 7 bites: an INLINE pnpm dlx vercel call in the deploy workflow FAILs", () => {
  const { workflowText, vercelJsonText } = realFiles();
  // Re-inline a Vercel call in a job (undoing the shared-script routing).
  const broken = workflowText.replace(
    "run: bash scripts/vercel/build.sh",
    'run: pnpm dlx vercel@"${VERCEL_CLI_VERSION}" build --prod --token "$VERCEL_TOKEN"',
  );
  assert.notEqual(broken, workflowText, "fixture edit must change the text");
  const { ok, failures } = evaluateDeploySync(broken, vercelJsonText, liveOpts());
  assert.equal(ok, false);
  assert.ok(
    failures.some((f) => f.startsWith("(7)") && /INLINE/.test(f)),
    "expected a property-7 inline failure; got:\n" + failures.join("\n"),
  );
});

test("property 7 bites: the rehearsal dropping a shared step script FAILs (divergence)", () => {
  const { workflowText, vercelJsonText } = realFiles();
  const opts = liveOpts();
  // Rehearsal stops running build.sh — it would no longer rehearse the build.
  const brokenRehearsal = opts.rehearsalText.replace(/run: bash scripts\/vercel\/build\.sh/g, "run: echo skipped");
  assert.notEqual(brokenRehearsal, opts.rehearsalText, "fixture edit must change the text");
  const { ok, failures } = evaluateDeploySync(workflowText, vercelJsonText, {
    ...opts,
    rehearsalText: brokenRehearsal,
  });
  assert.equal(ok, false);
  assert.ok(
    failures.some((f) => f.startsWith("(7)") && /build\.sh/.test(f)),
    "expected a property-7 divergence failure; got:\n" + failures.join("\n"),
  );
});

test("property 7 bites: the rehearsal running promote.sh (production-mutating) FAILs", () => {
  const { workflowText, vercelJsonText } = realFiles();
  const opts = liveOpts();
  const brokenRehearsal = opts.rehearsalText.replace(
    "run: bash scripts/vercel/deploy.sh",
    "run: bash scripts/vercel/promote.sh",
  );
  assert.notEqual(brokenRehearsal, opts.rehearsalText, "fixture edit must change the text");
  const { failures } = evaluateDeploySync(workflowText, vercelJsonText, { ...opts, rehearsalText: brokenRehearsal });
  assert.ok(
    failures.some((f) => f.startsWith("(7)") && /promote\.sh/.test(f) && /PRODUCTION/.test(f)),
    "expected a property-7 production-mutating failure; got:\n" + failures.join("\n"),
  );
});

test("property 7 bites: a missing rehearsal workflow FAILs", () => {
  const { workflowText, vercelJsonText } = realFiles();
  const opts = liveOpts();
  const { failures } = evaluateDeploySync(workflowText, vercelJsonText, { ...opts, rehearsalText: "" });
  // rehearsalText "" is treated as present-but-empty; it misses every script.
  assert.ok(
    failures.some((f) => f.startsWith("(7)")),
    "expected property-7 failures for an empty rehearsal; got:\n" + failures.join("\n"),
  );
});

// The red-on-broken proof the issue asks for: origin/main's OWN pre-fix
// web-build + web-promote, where `ls` and `promote` carry no --scope and run
// with no prior `vercel pull` in their job. This exact guard would have caught
// the #1037 incident (promote -> "User not found. (404)").
const PREFIX_1037_WORKFLOW = `name: Deploy (AWS)
on:
  workflow_dispatch:
permissions:
  contents: read
env:
  VERCEL_CLI_VERSION: "65.9.0"
jobs:
  plan:
    name: Plan (cdk diff)
    runs-on: ubuntu-24.04-arm
    steps:
      - run: echo plan
  web-build:
    name: Build + upload web (Vercel)
    needs: plan
    runs-on: ubuntu-latest
    steps:
      - name: Require Vercel credentials
        env:
          VERCEL_TOKEN: x
          VERCEL_ORG_ID: y
          VERCEL_PROJECT_ID: z
        run: |
          [ -n "$VERCEL_TOKEN" ] || exit 1
      - name: Record previous production deployment
        run: |
          prev="$(pnpm dlx vercel@"\${VERCEL_CLI_VERSION}" ls --prod --token "$VERCEL_TOKEN" 2>/dev/null)"
      - name: vercel pull (production)
        run: pnpm dlx vercel@"\${VERCEL_CLI_VERSION}" pull --yes --environment=production --token "$VERCEL_TOKEN"
      - name: vercel build (production)
        run: pnpm dlx vercel@"\${VERCEL_CLI_VERSION}" build --prod --token "$VERCEL_TOKEN"
      - name: vercel deploy
        run: pnpm dlx vercel@"\${VERCEL_CLI_VERSION}" deploy --prebuilt --prod --skip-domain --token "$VERCEL_TOKEN"
  deploy:
    name: Deploy
    needs: [plan, web-build]
    runs-on: ubuntu-24.04-arm
    steps:
      - run: echo deploy
  migrate:
    name: Apply DB migrations
    needs: deploy
    runs-on: ubuntu-latest
    steps:
      - run: echo migrate
  web-promote:
    name: Promote web to production
    needs: [web-build, deploy, migrate]
    runs-on: ubuntu-latest
    steps:
      - name: vercel promote
        run: pnpm dlx vercel@"\${VERCEL_CLI_VERSION}" promote "\${DEPLOYMENT_URL}" --token "$VERCEL_TOKEN"
  smoke:
    name: Post-deploy smoke
    needs: [deploy, migrate, web-promote]
    uses: ./.github/workflows/smoke-deployed.yml
  release:
    name: GitHub Release
    needs: [plan, web-build, deploy, migrate, web-promote, smoke]
    runs-on: ubuntu-latest
    steps:
      - run: echo release
`;

test("origin/main's pre-fix Vercel calls FAIL property 6 (would have caught #1037)", () => {
  const { vercelJsonText } = realFiles();
  const { ok, failures } = evaluateDeploySync(PREFIX_1037_WORKFLOW, vercelJsonText);
  assert.equal(ok, false, "pre-fix workflow must fail the guard");
  const p6 = failures.filter((f) => f.startsWith("(6)"));
  // Both the pre-pull `ls` and the unscoped `promote` must be flagged.
  assert.ok(
    p6.some((f) => /\bls\b/.test(f)),
    "expected the pre-pull `ls` call to be flagged; got:\n" + p6.join("\n"),
  );
  assert.ok(
    p6.some((f) => /promote/.test(f)),
    "expected the unscoped `promote` call to be flagged; got:\n" + p6.join("\n"),
  );
});

test("vercelCalls classifies scope / prior-pull correctly", () => {
  const block = `    steps:
      - name: a
        run: pnpm dlx vercel@"x" ls --prod --scope "$O" --token t
      - name: b
        run: pnpm dlx vercel@"x" pull --yes --token t
      - name: c
        run: pnpm dlx vercel@"x" build --prod --token t
      - name: d
        run: echo "vercel promote <url> --token t"
`;
  const calls = vercelCalls(block, "job");
  // The echo line is NOT a call.
  assert.deepEqual(
    calls.map((c) => c.subcommand),
    ["ls", "pull", "build"],
  );
  assert.equal(calls[0].scoped, true); // ls has --scope
  assert.equal(calls[0].afterPull, false);
  assert.equal(calls[2].afterPull, true); // build is after pull
  assert.equal(calls[2].scoped, false);
});

// --- A few unit checks on the parser helpers. --------------------------------

test("parseJobs finds jobs in source order", () => {
  const names = parseJobs(PREFIX_WORKFLOW).map(([n]) => n);
  assert.deepEqual(names, ["plan", "deploy", "migrate", "smoke", "release"]);
});

test("jobNeeds reads scalar, inline-list and block-list forms", () => {
  assert.deepEqual(jobNeeds("    needs: plan\n"), ["plan"]);
  assert.deepEqual(jobNeeds("    needs: [a, b, c]\n"), ["a", "b", "c"]);
  assert.deepEqual(jobNeeds("    needs:\n      - a\n      - b\n"), ["a", "b"]);
  assert.deepEqual(jobNeeds("    runs-on: x\n"), []);
});

test("dependsOn follows the graph transitively", () => {
  const g = new Map([
    ["release", ["smoke"]],
    ["smoke", ["web-promote"]],
    ["web-promote", ["deploy"]],
    ["deploy", ["web-build"]],
    ["web-build", ["plan"]],
    ["plan", []],
  ]);
  assert.equal(dependsOn(g, "release", "web-build"), true);
  assert.equal(dependsOn(g, "deploy", "web-build"), true);
  assert.equal(dependsOn(g, "web-build", "deploy"), false);
});
