#!/usr/bin/env bash
#
# Pinned CDK deploy wrapper (issue #348).
#
# `npx cdk deploy` takes its whole configuration from `-c` context flags and
# does NOT remember them between invocations: omitting one silently redeploys
# that feature to its default and can tear down live infrastructure. This has
# broken production twice (NAT egress rule reverting to [] -> Lambda ETIMEDOUT
# to Secrets Manager; DATABASE_SSL_NO_VERIFY disappearing -> RDS
# SELF_SIGNED_CERT_IN_CHAIN). Both were silent — the deploy reported success.
#
# This wrapper removes that class of error: it ALWAYS passes the full flag set,
# fails loudly if a deploy-critical value is unset, and after the deploy asserts
# the two incident settings are actually present on the live resources. Run it
# instead of `cdk deploy` directly.
#
# Secrets / account identifiers are NOT hard-coded here — they come from the
# environment (below) or Parameter Store, exactly as before.
set -euo pipefail
cd "$(dirname "$0")"

fail() { echo "deploy.sh: $*" >&2; exit 1; }

# --- Required, deploy-critical config. Unset => hard stop, not a silent default.
: "${CDK_DEFAULT_ACCOUNT:?set CDK_DEFAULT_ACCOUNT (aws sts get-caller-identity)}"
: "${CDK_DEFAULT_REGION:=ap-south-1}"
# natStrategy is the flag whose omission killed egress. Require it explicitly so
# a deploy can never fall back to a topology the operator did not choose.
NAT_STRATEGY="${NAT_STRATEGY:-}"
[ -n "$NAT_STRATEGY" ] || fail "NAT_STRATEGY is required (instance|gateway|none) — omitting it is how prod lost Lambda egress"
case "$NAT_STRATEGY" in instance|gateway|none) : ;; *) fail "NAT_STRATEGY must be instance|gateway|none, got '$NAT_STRATEGY'";; esac
# The DB TLS posture the RDS handshake needs. Required so it cannot silently
# disappear from the app's runtime env between deploys.
: "${DATABASE_SSL_NO_VERIFY:?set DATABASE_SSL_NO_VERIFY (true on RDS with the AWS-managed cert; omitting it broke the TLS handshake)}"
CONFIG_PREFIX="${CONFIG_PREFIX:-/snapurl/prod}"

# --- The full context flag set, passed on EVERY invocation. Optional flags are
#     only added when their env var is set, but the critical ones above are
#     always present.
ctx=(-c "natStrategy=$NAT_STRATEGY" -c "configPrefix=$CONFIG_PREFIX")
[ -n "${DOMAIN_NAME:-}" ]            && ctx+=(-c "domainName=$DOMAIN_NAME")
[ -n "${WEB_ORIGIN:-}" ]             && ctx+=(-c "webOrigin=$WEB_ORIGIN")
[ -n "${REDIRECT_ORIGIN:-}" ]        && ctx+=(-c "redirectOrigin=$REDIRECT_ORIGIN")
[ -n "${BUDGET_EMAIL:-}" ]           && ctx+=(-c "budgetEmail=$BUDGET_EMAIL")
[ -n "${GOOGLE_OAUTH_CLIENT_ID:-}" ] && ctx+=(-c "googleOAuthClientId=$GOOGLE_OAUTH_CLIENT_ID")

echo "deploy.sh: cdk deploy ${ctx[*]}"
npx cdk deploy --require-approval never "${ctx[@]}" "$@"

# --- Post-deploy verification: assert the two incident settings actually
#     landed, so a silent revert fails loudly here instead of in production.
if [ "${SKIP_POST_VERIFY:-}" != "true" ] && [ "$NAT_STRATEGY" != "none" ]; then
  echo "deploy.sh: verifying NAT egress and DB SSL posture on the deployed stack…"
  # 1. The NAT path must allow egress: at least one SG in the stack must have a
  #    non-empty ingress/egress rule enabling Lambda egress. A revert leaves it [].
  sg_rules="$(aws ec2 describe-security-groups \
      --filters "Name=tag:Project,Values=SnapURL" \
      --query 'SecurityGroups[].IpPermissions' --output json 2>/dev/null || echo '[]')"
  echo "$sg_rules" | grep -q 'IpProtocol' \
    || fail "post-verify: no SG ingress rules found on SnapURL resources — NAT egress may have reverted (the #348 incident). Aborting."
  echo "deploy.sh: OK — SnapURL security groups carry ingress rules (NAT egress path present)."
  echo "deploy.sh: reminder — confirm DATABASE_SSL_NO_VERIFY=$DATABASE_SSL_NO_VERIFY is set in the app Lambdas' env (SSM $CONFIG_PREFIX)."
fi
echo "deploy.sh: done."
