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
import { evaluateDeploySync, parseJobs, jobNeeds, dependsOn } from "./deploy-sync-guard.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = join(here, "..");
const read = (p) => readFileSync(join(repoRoot, p), "utf8");

// --- The real, post-fix files. -----------------------------------------------

test("the live deploy-aws.yml + web/vercel.json PASS all five properties", () => {
  const workflowText = read(".github/workflows/deploy-aws.yml");
  const vercelJsonText = read("web/vercel.json");
  const { ok, failures } = evaluateDeploySync(workflowText, vercelJsonText);
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
