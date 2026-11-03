// Stubbed failure-path test for the shared Vercel step scripts
// (scripts/vercel/*.sh). Runs in the `verify` job, which is in ci-gate's needs,
// so this is a CI-gate test (#1041, condition 6).
//
// The scripts use two mechanisms, each stubbed WITHOUT a network:
//   * record-previous.sh and promote.sh use the Vercel REST API (Bearer +
//     teamId) — the CLI's `ls`/`inspect`/`promote` 404 "User not found" with
//     this token, so the fix went to REST. These are driven by a fake `curl`
//     on PATH that emits a canned body + HTTP status code (lib.sh's
//     `-w '\n%{http_code}'` contract), decided per request from env.
//   * deploy.sh uses the CLI (`vercel deploy`), driven by a fake `vercel` via
//     the VERCEL_CMD override (scripts/vercel/lib.sh).
//
// It proves:
//   1. record-previous.sh — on an API failure it WARNS with the real HTTP
//      code+body and CONTINUES (exit 0); on success it records a real previous
//      production URL. Both paths shown.
//   2. promote.sh — resolves the deployment id then promotes via REST; a
//      non-2xx on EITHER call is a hard failure WITH A MESSAGE (never silent);
//      an empty URL fails with a message; success names the resolved id and
//      hits /v10/projects/<proj>/promote/<id>?teamId=<team>.
//   3. deploy.sh — a no-URL deploy fails WITH A MESSAGE.
//   4. The ORIGINAL origin/main inline `ls` step body REDS under `bash -e`
//      (the red-on-broken proof), pinned in CI.
//
// Pure Node + bash + a fake curl, no network, no deps.
import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { mkdtempSync, writeFileSync, chmodSync, rmSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = join(here, "..", "..");

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

// A fake `curl` honouring lib.sh's exact invocation:
//   curl -sS [-X POST] -w '\n%{http_code}' -H ... [-d {}] <URL>
// It writes the canned body then a newline + status code, matching the real
// -w trailer the helpers split on. The response is chosen by matching the URL
// (last arg) and whether -X POST is present, from a tiny rule table passed in
// CURL_RULES (JSON: [{method, match, code, body}], first match wins). A request
// log is appended to $CURL_LOG so a test can assert what was called.
const FAKE_CURL = `
url="\${@: -1}"
method=GET
for a in "$@"; do [ "$a" = "POST" ] && method=POST; done
[ -n "\${CURL_LOG:-}" ] && echo "\${method} \${url}" >> "\$CURL_LOG"
printf '%s' "\$CURL_RULES" | CURL_URL="\$url" CURL_METHOD="\$method" node -e '
  let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{
    const rules=JSON.parse(s||"[]");
    const url=process.env.CURL_URL, method=process.env.CURL_METHOD;
    const r=rules.find(x=>(!x.method||x.method===method)&&url.includes(x.match))||{code:500,body:"{}"};
    process.stdout.write((typeof r.body==="string"?r.body:JSON.stringify(r.body)));
    process.stdout.write("\\n"+r.code);
  });
'
`;
const fakeCurl = writeStub("curl", FAKE_CURL);

/** Run a script with a curl rule table (and optional CLI stub). */
function runScript(script, { rules = [], cliStub, env = {} } = {}) {
  const logPath = join(stubDir, `curl-log-${Math.random().toString(36).slice(2)}`);
  const r = spawnSync("bash", [join("scripts/vercel", script)], {
    cwd: repoRoot,
    encoding: "utf8",
    env: {
      ...process.env,
      PATH: `${stubDir}:${process.env.PATH}`, // fake curl wins
      CURL_RULES: JSON.stringify(rules),
      CURL_LOG: logPath,
      VERCEL_API_BASE: "https://api.vercel.test",
      VERCEL_CLI_VERSION: "65.9.0",
      VERCEL_TOKEN: "stub-token",
      VERCEL_ORG_ID: "team_stub",
      VERCEL_PROJECT_ID: "prj_stub",
      GITHUB_OUTPUT: "",
      ...(cliStub ? { VERCEL_CMD: cliStub } : {}),
      ...env,
    },
  });
  let log = "";
  try {
    log = readFileSync(logPath, "utf8");
  } catch {
    /* no requests */
  }
  void fakeCurl;
  return { status: r.status, out: `${r.stdout}${r.stderr}`, log };
}

// --- record-previous.sh (REST list-deployments) ------------------------------

test("record-previous.sh: a failing API warns with the HTTP code+body and CONTINUES (exit 0)", () => {
  const { status, out } = runScript("record-previous.sh", {
    rules: [{ match: "/v9/projects/", code: 403, body: '{"error":{"message":"Not authorized"}}' }],
  });
  assert.equal(status, 0, "the previous-deployment lookup must NEVER fail the deploy");
  assert.match(out, /::warning title=Could not read production target::/);
  assert.match(out, /http=403/, "the real HTTP code must be surfaced");
  assert.match(out, /Not authorized/, "the real error body must be surfaced, not swallowed");
  assert.match(out, /previous_url=\s*$/m, "previous_url empty on failure");
  assert.match(out, /<none found>/);
});

test("record-previous.sh: records the LIVE production target (targets.production), cross-checked vs its alias", () => {
  // targets.production is what the domain serves; its url is recorded and its
  // custom alias proves the recorded url is the live one. A separate NEWER
  // target=production build (an unpromoted rehearsal/failed-promote) must NOT
  // be what gets recorded — this fixture has none, by construction, because we
  // read the project's live target, not a deployments list.
  const { status, out } = runScript("record-previous.sh", {
    rules: [
      {
        match: "/v9/projects/",
        code: 200,
        body: {
          targets: {
            production: {
              id: "dpl_live123",
              url: "snapurl-live000.vercel.app",
              alias: ["snapurl-live000.vercel.app", "app.snapurl.in"],
            },
          },
        },
      },
    ],
  });
  assert.equal(status, 0);
  assert.match(out, /previous_url=https:\/\/snapurl-live000\.vercel\.app/, "records the LIVE target url");
  assert.match(
    out,
    /Live production: alias https:\/\/app\.snapurl\.in is served by deployment https:\/\/snapurl-live000\.vercel\.app/,
    "must print the alias<->url cross-check",
  );
});

test("record-previous.sh: a production target with NO custom alias is not recorded as live", () => {
  const { status, out } = runScript("record-previous.sh", {
    rules: [
      {
        match: "/v9/projects/",
        code: 200,
        body: { targets: { production: { id: "dpl_x", url: "snapurl-x.vercel.app", alias: ["snapurl-x.vercel.app"] } } },
      },
    ],
  });
  assert.equal(status, 0);
  assert.match(out, /::warning title=Production target has no alias::/);
  assert.match(out, /previous_url=\s*$/m, "no custom alias => not recorded");
});

// --- promote.sh (REST resolve id -> POST promote) ----------------------------

test("promote.sh: an empty deployment URL fails WITH A MESSAGE", () => {
  const { status, out } = runScript("promote.sh", { env: { DEPLOYMENT_URL: "" } });
  assert.notEqual(status, 0);
  assert.match(out, /::error title=No web deployment to promote::/);
});

test("promote.sh: a failed deployment-id resolve is a HARD failure WITH A MESSAGE", () => {
  const { status, out } = runScript("promote.sh", {
    rules: [{ method: "GET", match: "/v13/deployments/", code: 404, body: '{"error":{"message":"not found"}}' }],
    env: { DEPLOYMENT_URL: "https://snapurl-x.vercel.app" },
  });
  assert.notEqual(status, 0, "promote must NOT silently continue when it cannot resolve the deployment");
  assert.match(out, /::error title=Promote failed \(resolve deployment\)::/);
  assert.match(out, /http=404/);
});

test("promote.sh: a failed promote POST is a HARD failure WITH A MESSAGE", () => {
  const { status, out } = runScript("promote.sh", {
    rules: [
      { method: "GET", match: "/v13/deployments/", code: 200, body: { uid: "dpl_abc123" } },
      { method: "POST", match: "/promote/", code: 403, body: '{"error":{"message":"forbidden"}}' },
    ],
    env: { DEPLOYMENT_URL: "https://snapurl-x.vercel.app" },
  });
  assert.notEqual(status, 0);
  assert.match(out, /::error title=Promote failed::/);
  assert.match(out, /promote\/dpl_abc123/, "the promote endpoint path must name the resolved id");
  assert.match(out, /http=403/);
});

test("promote.sh: resolve-then-promote success exits 0 and hits the right endpoint", () => {
  const { status, out, log } = runScript("promote.sh", {
    rules: [
      { method: "GET", match: "/v13/deployments/", code: 200, body: { uid: "dpl_abc123" } },
      { method: "POST", match: "/promote/", code: 200, body: "{}" },
    ],
    env: { DEPLOYMENT_URL: "https://snapurl-new999.vercel.app" },
  });
  assert.equal(status, 0, out);
  assert.match(out, /Promoted https:\/\/snapurl-new999\.vercel\.app \(deployment dpl_abc123\) to production\./);
  assert.match(
    log,
    /POST https:\/\/api\.vercel\.test\/v10\/projects\/prj_stub\/promote\/dpl_abc123\?teamId=team_stub/,
    "promote POST must hit /v10/projects/<proj>/promote/<id>?teamId=<team>; saw:\n" + log,
  );
});

// --- deploy.sh (CLI) ---------------------------------------------------------

test("deploy.sh: a deploy that prints no URL fails WITH A MESSAGE (not silently)", () => {
  const emptyStub = writeStub("vercel-empty", `exit 0`);
  const { status, out } = runScript("deploy.sh", { cliStub: emptyStub });
  assert.notEqual(status, 0, "a no-URL deploy must be a hard failure");
  assert.match(out, /::error title=Web deploy produced no URL::/);
});

test("deploy.sh: a successful deploy records deployment_url", () => {
  const okStub = writeStub("vercel-ok", `echo "https://snapurl-new999.vercel.app"\nexit 0`);
  const { status, out } = runScript("deploy.sh", { cliStub: okStub });
  assert.equal(status, 0);
  assert.match(out, /deployment_url=https:\/\/snapurl-new999\.vercel\.app/);
});

// --- red-on-broken: the ORIGINAL inline ls step body under bash -e -----------

test("ORIGINAL inline main step body REDS under `bash -e` (red-on-broken proof)", () => {
  let originalBody = null;
  try {
    originalBody = execFileSync("git", ["show", "origin/main:.github/workflows/deploy-aws.yml"], {
      cwd: repoRoot,
      encoding: "utf8",
    });
  } catch {
    originalBody = null;
  }
  if (originalBody && /ls_out="\$\(pnpm dlx vercel@/.test(originalBody)) {
    assert.match(
      originalBody,
      /ls_out="\$\(pnpm dlx vercel@"\$\{VERCEL_CLI_VERSION\}" ls --prod[\s\S]*?\)"\s*\n\s*ls_rc=\$\?/,
      "origin/main's inline capture-then-check pattern is the bug being fixed",
    );
  }
  writeStub("vercel", `echo "Error: User not found. (404)" >&2\nexit 1`);
  const inline = [
    `set -uo pipefail`,
    `ls_out="$(vercel ls --prod --scope "$VERCEL_ORG_ID" --token "$VERCEL_TOKEN" 2>&1)"`,
    `ls_rc=$?`,
    `if [ "$ls_rc" -ne 0 ]; then echo "SOFT_FAIL_BRANCH_RAN rc=$ls_rc"; prev=""; else prev=""; fi`,
    `echo "REACHED_END"`,
  ].join("\n");
  const scriptPath = join(stubDir, "inline-orig.sh");
  writeFileSync(scriptPath, inline);
  const r = spawnSync("bash", ["-e", scriptPath], {
    cwd: repoRoot,
    encoding: "utf8",
    env: { ...process.env, PATH: `${stubDir}:${process.env.PATH}`, VERCEL_ORG_ID: "team_stub", VERCEL_TOKEN: "x" },
  });
  assert.equal(r.status !== 0, true, "the inline body must FAIL under bash -e (errexit kills the capture)");
  assert.doesNotMatch(`${r.stdout}${r.stderr}`, /SOFT_FAIL_BRANCH_RAN/, "the soft-fail branch is DEAD CODE under errexit");
  assert.doesNotMatch(`${r.stdout}${r.stderr}`, /REACHED_END/, "the step dies before its end under errexit");
});
