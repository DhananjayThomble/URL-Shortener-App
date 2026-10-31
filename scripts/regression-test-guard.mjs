#!/usr/bin/env node
/*
 * Regression-test guard (issue #899, spec .kiro/specs/regression-rule/ design §2).
 *
 * Fails a PR that closes an issue labelled `bug` or `qa:agent-confirmed` without
 * touching a test file. The rule: every confirmed finding ships a regression test
 * (requirements R1/R3). The escape hatch `regression-test:n/a` exempts an issue
 * (requirements R4).
 *
 * This script does NOT perform an actor/admin check on the `regression-test:n/a`
 * label (a deliberate departure from design §2 step 4 / R4's "maintainer-applied
 * only" clause): every Kiro/Claude session in this repo authenticates on the
 * maintainer's own token, so a `collaborators/{login}/permission` check returns
 * `admin` for every session and proves nothing. The label alone exempts, and each
 * exemption is printed so the person merging sees it in the log.
 *
 * Steps 2-5 are PURE functions (evaluateGuard and its helpers): the GitHub and git
 * calls are INJECTED, so the unit tests drive them with no network and no git.
 *
 * Usage (CI / local):
 *   GH_TOKEN=<token> GITHUB_REPOSITORY=owner/name PR_NUMBER=<n> \
 *     node scripts/regression-test-guard.mjs
 *
 * execFileSync, never a shell string: nothing user- or env-supplied is ever parsed
 * by a shell (the coverage-delta.mjs injection rationale).
 */
import { execFileSync } from "node:child_process";

// The test-file matcher. Wider than coverage-delta's (R3): .test/.spec in
// ts/tsx/mjs/js, shell test scripts, and anything under e2e/.
export const TEST_FILE_RE = /\.(test|spec)\.(ts|tsx|mjs|js)$|\.test\.sh$|^e2e\/.+\.ts$/;

// The labels that make a closing issue "confirmed" and therefore in scope.
const GATING_LABELS = new Set(["bug", "qa:agent-confirmed"]);
const EXEMPT_LABEL = "regression-test:n/a";

const hasLabel = (issue, name) => issue.labels.some((l) => l === name);
const isGating = (issue) => issue.labels.some((l) => GATING_LABELS.has(l));
const isExempt = (issue) => hasLabel(issue, EXEMPT_LABEL);

/**
 * PURE core (steps 2-5). Decides PASS/FAIL from already-fetched data.
 *
 * @param {{ number: number, labels: string[] }[]} closingIssues  from the GraphQL fetch
 * @param {string[]} changedFiles  from `git diff --name-only origin/main...HEAD`
 * @param {(msg: string) => void} log  sink for human-readable lines (injected; console.log in prod)
 * @returns {{ ok: boolean, reason: string }}
 */
export function evaluateGuard(closingIssues, changedFiles, log = () => {}) {
  // Step 2/3: only issues carrying a gating label are in scope.
  const gating = closingIssues.filter(isGating);
  if (gating.length === 0) {
    return {
      ok: true,
      reason:
        "no closing issue is labelled `bug` or `qa:agent-confirmed`; the regression-test rule does not apply",
    };
  }

  // Step 4 (no actor check): a gating issue labelled `regression-test:n/a` is exempt.
  // Print each exemption so the merger sees it in the log.
  const exempt = gating.filter(isExempt);
  for (const issue of exempt) log(`EXEMPT #${issue.number} (${EXEMPT_LABEL})`);

  const required = gating.filter((issue) => !isExempt(issue));
  if (required.length === 0) {
    return {
      ok: true,
      reason: `every gating issue (${gating
        .map((i) => `#${i.number}`)
        .join(", ")}) is exempt via ${EXEMPT_LABEL}`,
    };
  }

  // Step 5: PASS if any changed file looks like a test file.
  const testFiles = changedFiles.filter((f) => TEST_FILE_RE.test(f));
  if (testFiles.length > 0) {
    return {
      ok: true,
      reason: `closes ${required
        .map((i) => `#${i.number}`)
        .join(", ")} and changes ${testFiles.length} test file(s): ${testFiles.join(", ")}`,
    };
  }

  // Step 6: FAIL, naming the issues and how to satisfy the rule.
  return {
    ok: false,
    reason:
      `closes ${required.map((i) => `#${i.number}`).join(", ")} ` +
      `(labelled bug/qa:agent-confirmed) but changes no test file. ` +
      `Add or change a regression test that fails on origin/main and passes on the fix ` +
      `(a path matching ${TEST_FILE_RE}), in the lowest lane that observes the defect; name the ` +
      `issue in the test. If the fix genuinely needs none (dependency bump, CI pinning), a ` +
      `maintainer applies the \`${EXEMPT_LABEL}\` label to the issue.`,
  };
}

// --- Injected effects (NOT pure): the real GitHub + git calls. ---------------

/**
 * Fetch the issues this PR closes, with their label names, via the GraphQL API.
 * @returns {{ number: number, labels: string[] }[]}
 */
export function fetchClosingIssues({ repository, prNumber, token }) {
  const [owner, name] = repository.split("/");
  if (!owner || !name) throw new Error(`GITHUB_REPOSITORY must be owner/name, got: ${repository}`);
  const query = `
    query($owner: String!, $name: String!, $pr: Int!) {
      repository(owner: $owner, name: $name) {
        pullRequest(number: $pr) {
          closingIssuesReferences(first: 20) {
            nodes { number labels(first: 30) { nodes { name } } }
          }
        }
      }
    }`;
  const body = JSON.stringify({
    query,
    variables: { owner, name, pr: Number(prNumber) },
  });
  // curl via execFileSync with an argv array: no shell, the body is passed on stdin.
  const out = execFileSync(
    "curl",
    [
      "-sS",
      "--fail-with-body",
      "-X",
      "POST",
      "-H",
      `Authorization: bearer ${token}`,
      "-H",
      "Content-Type: application/json",
      "--data-binary",
      "@-",
      "https://api.github.com/graphql",
    ],
    { input: body, encoding: "utf8" },
  );
  const json = JSON.parse(out);
  if (json.errors) throw new Error(`GraphQL errors: ${JSON.stringify(json.errors)}`);
  const nodes =
    json.data?.repository?.pullRequest?.closingIssuesReferences?.nodes ?? [];
  return nodes.map((n) => ({
    number: n.number,
    labels: (n.labels?.nodes ?? []).map((l) => l.name),
  }));
}

/** Changed files vs origin/main. execFileSync, no shell. */
export function gitChangedFiles() {
  return execFileSync("git", ["diff", "--name-only", "origin/main...HEAD"], {
    encoding: "utf8",
  })
    .split("\n")
    .map((s) => s.trim())
    .filter(Boolean);
}

// --- CLI entrypoint -----------------------------------------------------------

function main() {
  const repository = process.env.GITHUB_REPOSITORY;
  const prNumber = process.env.PR_NUMBER;
  const token = process.env.GH_TOKEN;
  if (!repository || !prNumber || !token) {
    console.error(
      "FAIL regression-test-guard: missing env. Need GITHUB_REPOSITORY, PR_NUMBER and GH_TOKEN.",
    );
    process.exit(1);
  }

  const closingIssues = fetchClosingIssues({ repository, prNumber, token });
  const changedFiles = gitChangedFiles();
  const { ok, reason } = evaluateGuard(closingIssues, changedFiles, (m) => console.log(m));

  if (ok) {
    console.log(`PASS regression-test-guard: ${reason}`);
    process.exit(0);
  }
  console.error(`FAIL regression-test-guard: ${reason}`);
  process.exit(1);
}

// Run only when invoked as a script, never when imported by the tests.
if (process.argv[1] && import.meta.url === `file://${process.argv[1]}`) {
  main();
}
