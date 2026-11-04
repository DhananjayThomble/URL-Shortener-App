// #1050 — platform-admin allowlist wiring: probe + deploy.sh behaviour, with a
// STUBBED `aws` and `npx` on PATH (no network, no AWS). Runs in `verify`, which
// is in ci-gate's needs.
//
// Defined behaviour (acceptance condition 3):
//   parameter present   -> probe prints "present"; deploy.sh passes
//                          -c platformAdminEmailsFromSsm=true
//   parameter missing   -> probe prints "absent" + ::warning::; deploy.sh still
//                          runs cdk deploy WITHOUT the flag (fail closed)
//   unreadable (AccessDenied, throttling, cannot assume the lookup role)
//                       -> probe exits 1 with the error CODE; deploy.sh aborts
//                          BEFORE cdk deploy
// And (condition 2) the allowlist value never reaches stdout/stderr: the stub
// `aws` prints the secret value for any get-parameter call that does not select
// only Parameter.Name, so a probe that dropped its --query would leak it here.
//
// On origin/main infra/bin/probe-platform-admins.sh does not exist and deploy.sh
// never reads the parameter, so every test below reds there.
import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, writeFileSync, chmodSync, rmSync, readFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "..");
const PROBE = join(repoRoot, "infra", "bin", "probe-platform-admins.sh");
const DEPLOY = join(repoRoot, "infra", "deploy.sh");
const SECRET = "leaky.admin@example.invalid,second.admin@example.invalid";

const dir = mkdtempSync(join(tmpdir(), "admins-stub-"));
process.on("exit", () => rmSync(dir, { recursive: true, force: true }));
const callLog = join(dir, "calls.log");

function stub(name, body) {
  const p = join(dir, name);
  writeFileSync(p, `#!/usr/bin/env bash\n${body}\n`);
  chmodSync(p, 0o755);
}
// MODE: present | missing | denied | throttled | assume-denied
stub(
  "aws",
  `
echo "aws $*" >> "${callLog}"
case "$1 $2" in
  "sts assume-role")
    if [ "$MODE" = assume-denied ]; then
      echo "An error occurred (AccessDenied) when calling the AssumeRole operation: User arn:aws:iam::1:role/x is not authorized" >&2; exit 254
    fi
    printf 'AKIAFAKE\\tSECRETFAKE\\tTOKENFAKE\\n'; exit 0;;
  "ssm get-parameter")
    case "$MODE" in
      missing) echo "An error occurred (ParameterNotFound) when calling the GetParameter operation:" >&2; exit 254;;
      denied) echo "An error occurred (AccessDeniedException) when calling the GetParameter operation: not authorized to perform ssm:GetParameter on arn:aws:ssm:::parameter/x" >&2; exit 254;;
      throttled) echo "An error occurred (ThrottlingException) when calling the GetParameter operation: Rate exceeded" >&2; exit 254;;
    esac
    case "$*" in
      *"--query Parameter.Name"*) echo "/snapurl/prod/platform-admin-emails";;
      *) echo "${SECRET}";;   # a probe that does not narrow its query would leak this
    esac
    exit 0;;
esac
echo "unexpected aws call: $*" >&2; exit 99
`,
);
stub("npx", `echo "npx $*" >> "${callLog}"; exit 0`);

function run(cmd, args, mode, extra = {}) {
  writeFileSync(callLog, "");
  const r = spawnSync("bash", [cmd, ...args], {
    encoding: "utf8",
    env: {
      PATH: `${dir}:${process.env.PATH}`,
      HOME: dir,
      MODE: mode,
      CDK_DEFAULT_ACCOUNT: "111111111111",
      CDK_DEFAULT_REGION: "ap-south-1",
      NAT_STRATEGY: "instance",
      DATABASE_SSL_NO_VERIFY: "true",
      SKIP_POST_VERIFY: "true",
      ...extra,
    },
  });
  return { ...r, calls: readFileSync(callLog, "utf8") };
}
const noLeak = (r) => {
  assert.ok(!(r.stdout + r.stderr + r.calls).includes("leaky.admin"), "allowlist value leaked");
};

test("the probe script exists and is executable", () => {
  assert.ok(existsSync(PROBE), "infra/bin/probe-platform-admins.sh is missing");
});

test("probe: parameter present -> 'present', reads via the CDK lookup role, never the value", () => {
  const r = run(PROBE, ["/snapurl/prod"], "present");
  assert.equal(r.status, 0, r.stderr);
  assert.equal(r.stdout.trim(), "present");
  assert.match(r.calls, /sts assume-role --role-arn arn:aws:iam::111111111111:role\/cdk-hnb659fds-lookup-role-111111111111-ap-south-1/);
  assert.match(r.calls, /ssm get-parameter .*--name \/snapurl\/prod\/platform-admin-emails/);
  noLeak(r);
});

test("probe: parameter missing -> 'absent' + warning, exit 0 (deploy continues, no admins)", () => {
  const r = run(PROBE, ["/snapurl/prod"], "missing");
  assert.equal(r.status, 0, r.stderr);
  assert.equal(r.stdout.trim(), "absent");
  assert.match(r.stderr, /::warning title=No platform admins::/);
  noLeak(r);
});

for (const mode of ["denied", "throttled", "assume-denied"]) {
  test(`probe: unreadable (${mode}) -> exit 1 with the error code, never 'absent'`, () => {
    const r = run(PROBE, ["/snapurl/prod"], mode);
    assert.equal(r.status, 1);
    assert.equal(r.stdout.trim(), "", "must not claim present/absent");
    assert.match(r.stderr, /::error title=Platform-admin allowlist unreadable::/);
    assert.match(r.stderr, /AccessDenied|Throttling/);
    // Only the bare error code is surfaced, not the AWS message (ARNs).
    assert.ok(!r.stderr.includes("arn:aws:iam::1:"), "AWS message with ARNs echoed");
    noLeak(r);
  });
}

test("deploy.sh: present -> cdk deploy gets platformAdminEmailsFromSsm=true, value not echoed", () => {
  const r = run(DEPLOY, ["SnapUrl"], "present");
  assert.equal(r.status, 0, r.stderr);
  assert.match(r.calls, /npx cdk deploy .*-c platformAdminEmailsFromSsm=true/);
  assert.match(r.stdout, /platformAdminEmailsFromSsm=true/);
  noLeak(r);
});

test("deploy.sh: missing -> deploy succeeds WITHOUT the flag (fail closed) and warns", () => {
  const r = run(DEPLOY, ["SnapUrl"], "missing");
  assert.equal(r.status, 0, r.stderr);
  assert.match(r.calls, /npx cdk deploy/);
  assert.ok(!/platformAdminEmails/.test(r.calls), "flag must be absent when the parameter is missing");
  assert.match(r.stderr, /No platform admins/);
});

for (const mode of ["denied", "throttled", "assume-denied"]) {
  test(`deploy.sh: unreadable (${mode}) -> fails with a message BEFORE cdk deploy`, () => {
    const r = run(DEPLOY, ["SnapUrl"], mode);
    assert.notEqual(r.status, 0);
    assert.ok(!/npx cdk deploy/.test(r.calls), "cdk deploy must not run");
    assert.match(r.stderr, /platform-admin allowlist probe failed/);
  });
}

test("deploy-aws.yml plan job runs the same probe and flag as deploy.sh", () => {
  const wf = readFileSync(join(repoRoot, ".github", "workflows", "deploy-aws.yml"), "utf8");
  assert.match(wf, /probe-platform-admins\.sh/);
  assert.match(wf, /-c "platformAdminEmailsFromSsm=true"/);
  // The workflow must not read the parameter value itself.
  assert.ok(!/get-parameter/.test(wf), "workflow must not call ssm get-parameter directly");
  assert.ok(!/PLATFORM_ADMIN_EMAILS/.test(wf), "no workflow env may carry the allowlist");
});
