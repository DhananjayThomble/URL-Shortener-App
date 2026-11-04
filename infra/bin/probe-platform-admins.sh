#!/usr/bin/env bash
#
# Does the platform-admin allowlist parameter exist? (#1050)
#
#   probe-platform-admins.sh <config-prefix>
#
# stdout: exactly "present" or "absent". Nothing else is ever written to
# stdout, and the parameter VALUE is never printed (the query selects only the
# parameter Name; the public Actions log must never see an email).
#
#   present            -> exit 0. The caller passes -c platformAdminEmailsFromSsm=true
#                         and CloudFormation resolves the value at deploy time.
#   ParameterNotFound  -> exit 0, "absent", plus a ::warning::. No admins: fail closed.
#   anything else      -> exit 1 with the AWS error CODE only (AccessDenied,
#                         throttling, no credentials, ...). Never "absent": a
#                         read problem must not silently drop the admins.
#
# Why a probe at all: CloudFormation fails the whole deploy on an unresolvable
# SSM parameter, so "missing => deploy anyway" can only be decided before synth.
#
# The GitHub OIDC plan/deploy roles hold no ssm:GetParameter on app config
# (docs/CD-AWS-OIDC.md forbids it), so the read goes through the CDK bootstrap
# lookup role they are already allowed to assume (ReadOnlyAccess, kms:Decrypt
# denied; this parameter is a plain String).
set -uo pipefail

prefix="${1:?usage: probe-platform-admins.sh <config-prefix>}"
prefix="${prefix%/}"
name="${prefix}/platform-admin-emails"
region="${CDK_DEFAULT_REGION:-${AWS_REGION:-ap-south-1}}"
account="${CDK_DEFAULT_ACCOUNT:-}"
qualifier="${CDK_QUALIFIER:-hnb659fds}"

err() { echo "::error title=Platform-admin allowlist unreadable::$*" >&2; }

code_of() { # AWS CLI stderr -> bare error code (no ARNs, no account ids)
  sed -n 's/.*An error occurred (\([A-Za-z0-9.]*\)).*/\1/p' <<<"$1" | head -1
}

if [ -z "$account" ]; then
  out="$(aws sts get-caller-identity --query Account --output text 2>&1)" \
    || { err "cannot determine the AWS account (${out:+$(code_of "$out")}); is the job authenticated?"; exit 1; }
  account="$out"
fi

role_arn="arn:aws:iam::${account}:role/cdk-${qualifier}-lookup-role-${account}-${region}"
creds="$(aws sts assume-role --role-arn "$role_arn" --role-session-name "snapurl-probe-admins" \
  --query 'Credentials.[AccessKeyId,SecretAccessKey,SessionToken]' --output text 2>&1)" || {
  err "could not assume the CDK lookup role to read ${name} ($(code_of "$creds"))."
  exit 1
}
read -r ak sk st <<<"$creds"
[ -n "$ak" ] && [ -n "$sk" ] && [ -n "$st" ] || { err "assume-role returned no credentials."; exit 1; }

# Scoped to this one command; the caller's own credentials stay untouched.
res="$(AWS_ACCESS_KEY_ID="$ak" AWS_SECRET_ACCESS_KEY="$sk" AWS_SESSION_TOKEN="$st" \
  aws ssm get-parameter --region "$region" --name "$name" --query 'Parameter.Name' --output text 2>&1)"
rc=$?
if [ $rc -eq 0 ]; then
  echo "present"
  echo "Platform-admin allowlist found at ${name}; it will be applied to the API Lambda." >&2
  exit 0
fi
if grep -q 'ParameterNotFound' <<<"$res"; then
  echo "::warning title=No platform admins::SSM parameter ${name} does not exist, so this deploy leaves PLATFORM_ADMIN_EMAILS unset on the API (the admin panel is unreachable, fail closed). Create it (comma-separated emails) and redeploy to enable admins." >&2
  echo "absent"
  exit 0
fi
err "reading ${name} failed ($(code_of "$res")). Refusing to deploy rather than silently drop the admins."
exit 1
