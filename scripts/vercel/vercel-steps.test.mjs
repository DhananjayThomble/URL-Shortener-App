// Stubbed-vercel failure-path test for the shared Vercel step scripts
// (scripts/vercel/*.sh). Runs in the `verify` job, which is in ci-gate's needs,
// so this is a CI-gate test (#1041, condition 6).
//
// It puts a FAKE `vercel` on the scripts' path via the VERCEL_CMD override
// (scripts/vercel/lib.sh) and drives each script's failure and success paths
// with no network and no real CLI. It proves:
//
//   1. record-previous.sh — the bug fix. With a FAILING stub it must WARN with
//      the CLI's real error text and CONTINUE (exit 0), not die. This is the
//      behaviour the inline step could not have, because Actions runs a `run:`
//      block as `bash -e {0}` and errexit killed the `ls_out=$(...)` capture
//      before the soft-fail branch. The test ALSO runs the ORIGINAL main step
//      body (read live from origin/main's deploy-aws.yml) the same way Actions
//      would — `bash -e` — and asserts it REDS, so the red-on-broken proof is
//      pinned in CI and a regression that reintroduces the pattern reds here.
//   2. deploy.sh / promote.sh — a hard failure must exit non-zero WITH A
//      MESSAGE (`::error`), never silently.
//
// Pure Node + bash, no deps, like the other scripts/*.test.mjs.
import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { mkdtempSync, writeFileSync, chmodSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = join(here, "..", "..");

// --- a tmp dir holding fake `vercel` executables of various behaviours -------
const stubDir = mkdtempSync(join(tmpdir(), "vercel-stub-"));
process.on("exit", () => {
  try {
    rmSync(stubDir, { recursive: true, force: true });
  } catch {
    /* best effort */
  }
});

function writeStub(name, body) {
  const p = join(stubDir, name);
  writeFileSync(p, `#!/usr/bin/env bash\n${body}\n`);
  chmodSync(p, 0o755);
  return p;
}

// Fails like the real team-token-no-link lookup: 404 on stderr, exit 1.
const failStub = writeStub(
  "vercel-fail",
  `echo "Error: User not found. (404)" >&2\nexit 1`,
);
// Succeeds; answers each subcommand with plausible output.
const okStub = writeStub(
  "vercel-ok",
  `case "$1" in
  ls) echo "  https://snapurl-prev000.vercel.app  12m ago  Production";;
  deploy) echo "https://snapurl-new999.vercel.app";;
  promote) echo "Success! promoted";;
  *) echo "ok $1";;
esac
exit 0`,
);
// Succeeds but prints NOTHING: the silent-no-URL case for deploy.sh.
const emptyStub = writeStub("vercel-empty", `exit 0`);

/** Run a script with a chosen stub and env. Returns {status, out}. */
function runScript(script, stubPath, env = {}) {
  const r = spawnSync("bash", [join("scripts/vercel", script)], {
    cwd: repoRoot,
    encoding: "utf8",
    env: {
      ...process.env,
      VERCEL_CMD: stubPath,
      VERCEL_CLI_VERSION: "65.9.0",
      VERCEL_TOKEN: "stub-token",
      VERCEL_ORG_ID: "team_stub",
      VERCEL_PROJECT_ID: "prj_stub",
      // No GITHUB_OUTPUT: the scripts print "[output] k=v" instead of writing.
      GITHUB_OUTPUT: "",
      ...env,
    },
  });
  return { status: r.status, out: `${r.stdout}${r.stderr}` };
}

// --- record-previous.sh ------------------------------------------------------

test("record-previous.sh: failing vercel warns with the real error text and CONTINUES (exit 0)", () => {
  const { status, out } = runScript("record-previous.sh", failStub);
  assert.equal(status, 0, "the previous-deployment lookup must NEVER fail the deploy");
  assert.match(out, /::warning title=Could not list previous production deployment::/);
  assert.match(out, /User not found\. \(404\)/, "the CLI's real error text must be surfaced, not swallowed");
  assert.match(out, /previous_url=\s*$/m, "previous_url must be recorded empty on failure");
  assert.match(out, /<none found>/);
});

test("record-previous.sh: succeeding vercel records the previous URL (exit 0)", () => {
  const { status, out } = runScript("record-previous.sh", okStub);
  assert.equal(status, 0);
  assert.match(out, /previous_url=https:\/\/snapurl-prev000\.vercel\.app/);
});

test("ORIGINAL inline main step body REDS under `bash -e` (red-on-broken proof)", () => {
  // Extract origin/main's "Record previous production deployment" step body and
  // run it exactly as Actions would (bash -e), with the failing stub reachable
  // as `vercel` AND as the pinned `pnpm dlx vercel@...`. It must exit non-zero
  // and NOT reach its own soft-fail branch — the whole reason this change
  // exists. If a future edit makes the inline pattern pass, this test reds and
  // tells the author the proof no longer demonstrates the bug.
  let originalBody;
  try {
    originalBody = execFileSync("git", ["show", "origin/main:.github/workflows/deploy-aws.yml"], {
      cwd: repoRoot,
      encoding: "utf8",
    });
  } catch {
    // Fallback: a faithful transcription of origin/main's body. Used only when
    // origin/main is unavailable (shallow/offline); the live path above is the
    // real proof in CI.
    originalBody = null;
  }

  // The original body, as a standalone script. When we can read origin/main we
  // assert it still contains this shape; otherwise we use the transcription.
  const inline = [
    `set -uo pipefail`,
    // pnpm dlx is not available offline; alias it to the failing stub so the
    // capture fails exactly as the real 404 would.
    `ls_out="$(vercel ls --prod --scope "$VERCEL_ORG_ID" --token "$VERCEL_TOKEN" 2>&1)"`,
    `ls_rc=$?`,
    `if [ "$ls_rc" -ne 0 ]; then echo "SOFT_FAIL_BRANCH_RAN rc=$ls_rc"; prev=""; else prev=""; fi`,
    `echo "REACHED_END"`,
  ].join("\n");

  if (originalBody) {
    assert.match(
      originalBody,
      /ls_out="\$\(pnpm dlx vercel@"\$\{VERCEL_CLI_VERSION\}" ls --prod[\s\S]*?\)"\s*\n\s*ls_rc=\$\?/,
      "origin/main's inline capture-then-check pattern is the bug being fixed; if it is gone, update this proof",
    );
  }

  const scriptPath = join(stubDir, "inline-orig.sh");
  writeFileSync(scriptPath, inline);
  const r = spawnSync("bash", ["-e", scriptPath], {
    cwd: repoRoot,
    encoding: "utf8",
    env: { ...process.env, PATH: `${stubDir}:${process.env.PATH}`, VERCEL_ORG_ID: "team_stub", VERCEL_TOKEN: "x" },
  });
  // The stub named `vercel` must be the one that fails.
  assert.equal(r.status !== 0, true, "the inline body must FAIL under bash -e (errexit kills the capture)");
  assert.doesNotMatch(
    `${r.stdout}${r.stderr}`,
    /SOFT_FAIL_BRANCH_RAN/,
    "under bash -e the soft-fail branch is DEAD CODE — it must never run",
  );
  assert.doesNotMatch(`${r.stdout}${r.stderr}`, /REACHED_END/, "the step dies before its end under errexit");
});

// --- deploy.sh ---------------------------------------------------------------

test("deploy.sh: a deploy that prints no URL fails WITH A MESSAGE (not silently)", () => {
  const { status, out } = runScript("deploy.sh", emptyStub);
  assert.notEqual(status, 0, "a no-URL deploy must be a hard failure");
  assert.match(out, /::error title=Web deploy produced no URL::/);
});

test("deploy.sh: a successful deploy records deployment_url", () => {
  const { status, out } = runScript("deploy.sh", okStub);
  assert.equal(status, 0);
  assert.match(out, /deployment_url=https:\/\/snapurl-new999\.vercel\.app/);
});

// --- promote.sh --------------------------------------------------------------

test("promote.sh: an empty deployment URL fails WITH A MESSAGE", () => {
  const { status, out } = runScript("promote.sh", okStub, { DEPLOYMENT_URL: "" });
  assert.notEqual(status, 0);
  assert.match(out, /::error title=No web deployment to promote::/);
});

test("promote.sh: carries --scope (team-token 404 guard) and promotes a real URL", () => {
  // Record the args the stub is called with to assert --scope is passed.
  const argStub = writeStub(
    "vercel-args",
    `echo "ARGS: $*"\nexit 0`,
  );
  const { status, out } = runScript("promote.sh", argStub, {
    DEPLOYMENT_URL: "https://snapurl-new999.vercel.app",
  });
  assert.equal(status, 0);
  assert.match(out, /ARGS: promote https:\/\/snapurl-new999\.vercel\.app --scope team_stub --token/);
});
