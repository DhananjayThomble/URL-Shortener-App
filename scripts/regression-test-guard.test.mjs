// Unit tests for the regression-test guard (issue #899), run by `node --test`.
//
// The guard's decision core `evaluateGuard` is PURE: it takes already-fetched
// closing issues and a changed-file list, so every case is driven here with no
// network and no git. Each test pins the verdict AND the observable effect that
// proves the case went down the intended branch (the EXEMPT line, the matched
// file), so a change that silently reroutes a case fails here.

import { test } from "node:test";
import assert from "node:assert/strict";
import { evaluateGuard, TEST_FILE_RE } from "./regression-test-guard.mjs";

// A log sink that records every line, so a test can assert what was printed.
const recorder = () => {
  const lines = [];
  return { log: (m) => lines.push(m), lines };
};

// Case 1: no closing issue at all -> PASS (the rule does not apply).
test("case 1: no closing issue -> PASS", () => {
  const { log, lines } = recorder();
  const r = evaluateGuard([], ["apps/api/src/handler.ts"], log);
  assert.equal(r.ok, true);
  assert.match(r.reason, /the regression-test rule does not apply/);
  assert.deepEqual(lines, [], "no EXEMPT line when there is no gating issue");
});

// Case 2: a closing issue with NO gating label (e.g. only `enhancement`) -> PASS.
test("case 2: non-bug closing issue -> PASS", () => {
  const { log, lines } = recorder();
  const issues = [{ number: 100, labels: ["enhancement", "UI/UX"] }];
  const r = evaluateGuard(issues, ["apps/api/src/handler.ts"], log);
  assert.equal(r.ok, true);
  assert.match(r.reason, /no closing issue is labelled/);
  assert.deepEqual(lines, []);

  // Prove the gating check is what let it pass: flip the label to `bug` with the
  // SAME (non-test) changed files and the verdict must flip to FAIL.
  const flipped = evaluateGuard([{ number: 100, labels: ["bug"] }], ["apps/api/src/handler.ts"], () => {});
  assert.equal(flipped.ok, false, "a bug label on the same inputs must FAIL");
});

// Case 3: a `bug` issue AND a changed test file -> PASS.
test("case 3: bug + test file -> PASS", () => {
  const { log } = recorder();
  const issues = [{ number: 200, labels: ["bug"] }];
  const changed = ["apps/api/src/handler.ts", "apps/api/src/handler.test.ts"];
  const r = evaluateGuard(issues, changed, log);
  assert.equal(r.ok, true);
  assert.match(r.reason, /changes 1 test file/);
  assert.match(r.reason, /handler\.test\.ts/);

  // Prove it was the test file that satisfied it: drop the test file and it FAILs.
  const noTest = evaluateGuard(issues, ["apps/api/src/handler.ts"], () => {});
  assert.equal(noTest.ok, false, "removing the test file must flip the verdict to FAIL");
});

// Case 4: a `bug` issue and NO test file touched -> FAIL, naming the issue + remedy.
test("case 4: bug + no test file -> FAIL", () => {
  const { log, lines } = recorder();
  const issues = [{ number: 300, labels: ["bug", "api"] }];
  const changed = ["apps/api/src/handler.ts", "README.md"];
  const r = evaluateGuard(issues, changed, log);
  assert.equal(r.ok, false);
  assert.match(r.reason, /#300/, "the failure names the offending issue");
  assert.match(r.reason, /no test file/);
  assert.match(r.reason, /regression-test:n\/a/, "the failure explains the escape hatch");
  assert.deepEqual(lines, [], "no EXEMPT line printed for a non-exempt issue");

  // Prove the matcher is the pivot: adding a .spec.ts file flips it to PASS.
  const withSpec = evaluateGuard(issues, [...changed, "e2e/journeys/j300-flow.ts"], () => {});
  assert.equal(withSpec.ok, true, "adding an e2e test file must flip the verdict to PASS");
});

// Case 5: a `bug` issue carrying `regression-test:n/a` -> PASS (exempt), and the
// EXEMPT line IS printed. No actor/admin check (brief override of design §2 step 4).
test("case 5: bug + regression-test:n/a -> PASS (exempt) and EXEMPT line printed", () => {
  const { log, lines } = recorder();
  const issues = [{ number: 400, labels: ["bug", "regression-test:n/a"] }];
  const changed = ["package.json", "pnpm-lock.yaml"]; // a dep bump, no test file
  const r = evaluateGuard(issues, changed, log);
  assert.equal(r.ok, true);
  assert.match(r.reason, /exempt/);
  assert.deepEqual(lines, ["EXEMPT #400 (regression-test:n/a)"], "the EXEMPT line is printed exactly");

  // Prove the exemption is doing the work: WITHOUT the n/a label, the same
  // no-test dep bump FAILs. So the label is what flipped the verdict, and there
  // is no hidden actor check that could also account for the pass.
  const notExempt = evaluateGuard([{ number: 400, labels: ["bug"] }], changed, () => {});
  assert.equal(notExempt.ok, false, "dropping regression-test:n/a must flip the verdict to FAIL");
});

// Belt-and-braces: a mixed set where one gating issue is exempt and another is
// not, with no test file -> still FAIL, and the exempt one is still logged. This
// guards the common "two closing issues" case the five-case list implies.
test("mixed: one exempt + one required, no test file -> FAIL, exempt still logged", () => {
  const { log, lines } = recorder();
  const issues = [
    { number: 500, labels: ["bug", "regression-test:n/a"] },
    { number: 501, labels: ["qa:agent-confirmed"] },
  ];
  const r = evaluateGuard(issues, ["apps/api/src/x.ts"], log);
  assert.equal(r.ok, false);
  assert.match(r.reason, /#501/);
  assert.doesNotMatch(r.reason, /#500/, "the exempt issue is not named as a failure cause");
  assert.deepEqual(lines, ["EXEMPT #500 (regression-test:n/a)"]);
});

// The matcher itself (R3): the patterns the guard must and must not treat as tests.
test("TEST_FILE_RE matches the required lanes and rejects non-tests", () => {
  for (const f of [
    "apps/api/src/handler.test.ts",
    "web/components/Button.spec.tsx",
    "scripts/regression-test-guard.test.mjs",
    "packages/domain/x.test.js",
    "scripts/dev-web-builds-packages.test.sh",
    "e2e/journeys/j771-sidebar-clicks-live.ts",
    "e2e/mocked-api/credential-401.spec.ts",
  ]) {
    assert.equal(TEST_FILE_RE.test(f), true, `should match: ${f}`);
  }
  for (const f of [
    "apps/api/src/handler.ts",
    "README.md",
    "package.json",
    "scripts/deploy.sh", // a shell script that is not a .test.sh
    "e2e/README.md", // under e2e but not a .ts
    "web/components/Button.tsx",
  ]) {
    assert.equal(TEST_FILE_RE.test(f), false, `should NOT match: ${f}`);
  }
});
