// Scratch throwaway test — regression-guard GREEN proof (#900).
//
// This file exists only to put a path matching the regression-guard's
// TEST_FILE_RE (/\.(test|spec)\.(ts|tsx|mjs|js)$/) into a PR diff that closes a
// `bug`-labelled issue, so the guard is shown to go GREEN. It is not wired into
// any package's vitest project, so it never runs in CI; the guard checks the
// diff filename, not the test result. This file, its PR, and the issue are
// deleted after the proof is captured.
import { test } from "node:test";
import assert from "node:assert/strict";

test("scratch #900 green-proof placeholder", () => {
  assert.equal(1 + 1, 2);
});
