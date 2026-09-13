# CI/CD to AWS via GitHub OIDC

One-time setup for `.github/workflows/deploy-aws.yml`, which replaced deploying
from an operator's laptop. Nothing here contains a secret, and no long-lived AWS
access key exists anywhere in this pipeline.

## Why the role is nearly powerless

CDK is already bootstrapped in this account (`CDKToolkit`, qualifier
`hnb659fds`). Bootstrapping created four roles that hold the actual deployment
power — one to drive CloudFormation, one to publish file assets, one to publish
container images, one to read context.

So the GitHub role does **not** need `PowerUserAccess`. It needs permission to
*assume those four roles*, plus a handful of direct read/invoke calls the deploy
wrapper and the post-deploy steps make with the ambient identity. If the GitHub
role were ever compromised, the blast radius is "can run a CDK deploy of this
app", not "owns the account".

## 1. The OIDC provider

Only one per account is needed. Skip if `token.actions.githubusercontent.com`
already appears in `aws iam list-open-id-connect-providers`.

```bash
aws iam create-open-id-connect-provider \
  --url https://token.actions.githubusercontent.com \
  --client-id-list sts.amazonaws.com
```

## 2. Two roles, and why

There are **two** roles, because the two stages have genuinely different needs
and different trust conditions:

| Role | Assumed by | Trusted subject | Can it change anything? |
| --- | --- | --- | --- |
| `snapurl-github-plan` | the `plan` job | the branch ref | No — read-only |
| `snapurl-github-deploy` | `deploy` / `migrate` | `environment:production` | Yes |

This split is forced by a real constraint, not invented for neatness. The
`deploy` role must be bound to the `production` environment, because that
binding is what makes the required-reviewer approval a *security* control rather
than a UI nicety — no approval, no token, no credentials. But `plan` has to run
**before** that approval so there is a diff to approve against, which means it
declares no environment and its OIDC subject is the branch ref instead. One role
cannot satisfy both without trusting the branch ref for deploys too, which would
let anyone who can push a branch deploy without approval.

### 2a. Plan role (read-only)

Create **`snapurl-github-plan`** with this trust policy. Adjust the branch if you
ever plan from somewhere other than `main`.

```json
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Effect": "Allow",
      "Principal": {
        "Federated": "arn:aws:iam::646799484931:oidc-provider/token.actions.githubusercontent.com"
      },
      "Action": "sts:AssumeRoleWithWebIdentity",
      "Condition": {
        "StringEquals": {
          "token.actions.githubusercontent.com:aud": "sts.amazonaws.com",
          "token.actions.githubusercontent.com:sub": "repo:DhananjayThomble/URL-Shortener-App:ref:refs/heads/main"
        }
      }
    }
  ]
}
```

Its only permission is to assume the CDK **lookup** role, which `cdk diff` uses
to read the deployed template. The lookup role is itself read-only, so this role
cannot mutate infrastructure even transitively.

```json
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Sid": "AssumeCdkLookupRoleOnly",
      "Effect": "Allow",
      "Action": "sts:AssumeRole",
      "Resource": [
        "arn:aws:iam::646799484931:role/cdk-hnb659fds-lookup-role-646799484931-ap-south-1",
        "arn:aws:iam::646799484931:role/cdk-hnb659fds-lookup-role-646799484931-us-east-1"
      ]
    },
    {
      "Sid": "ReadBootstrapVersion",
      "Effect": "Allow",
      "Action": "ssm:GetParameter",
      "Resource": [
        "arn:aws:ssm:ap-south-1:646799484931:parameter/cdk-bootstrap/hnb659fds/version",
        "arn:aws:ssm:us-east-1:646799484931:parameter/cdk-bootstrap/hnb659fds/version"
      ]
    }
  ]
}
```

### 2b. Deploy role trust policy

Create **`snapurl-github-deploy`** with this trust policy. The `sub` is scoped to
the **`production` environment**, not to a branch — a token is only issued for a
job that declares `environment: production`, and that environment's required
reviewer must approve first.

```json
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Effect": "Allow",
      "Principal": {
        "Federated": "arn:aws:iam::646799484931:oidc-provider/token.actions.githubusercontent.com"
      },
      "Action": "sts:AssumeRoleWithWebIdentity",
      "Condition": {
        "StringEquals": {
          "token.actions.githubusercontent.com:aud": "sts.amazonaws.com",
          "token.actions.githubusercontent.com:sub": "repo:DhananjayThomble/URL-Shortener-App:environment:production"
        }
      }
    }
  ]
}
```

## 3. Deploy role permissions

Attach as an inline policy named `snapurl-deploy`. Two statements: assume the
bootstrap roles, and the direct calls made outside them.

`us-east-1` appears because the CloudFront ACM certificate lives in a second
stack (`SnapUrlCert`) in that region, and deploying `SnapUrl` resolves a
cross-region reference to it. Both regions must be bootstrapped.

```json
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Sid": "AssumeCdkBootstrapRoles",
      "Effect": "Allow",
      "Action": "sts:AssumeRole",
      "Resource": [
        "arn:aws:iam::646799484931:role/cdk-hnb659fds-deploy-role-646799484931-ap-south-1",
        "arn:aws:iam::646799484931:role/cdk-hnb659fds-file-publishing-role-646799484931-ap-south-1",
        "arn:aws:iam::646799484931:role/cdk-hnb659fds-image-publishing-role-646799484931-ap-south-1",
        "arn:aws:iam::646799484931:role/cdk-hnb659fds-lookup-role-646799484931-ap-south-1",
        "arn:aws:iam::646799484931:role/cdk-hnb659fds-deploy-role-646799484931-us-east-1",
        "arn:aws:iam::646799484931:role/cdk-hnb659fds-file-publishing-role-646799484931-us-east-1",
        "arn:aws:iam::646799484931:role/cdk-hnb659fds-image-publishing-role-646799484931-us-east-1",
        "arn:aws:iam::646799484931:role/cdk-hnb659fds-lookup-role-646799484931-us-east-1"
      ]
    },
    {
      "Sid": "ReadBootstrapVersion",
      "Effect": "Allow",
      "Action": "ssm:GetParameter",
      "Resource": [
        "arn:aws:ssm:ap-south-1:646799484931:parameter/cdk-bootstrap/hnb659fds/version",
        "arn:aws:ssm:us-east-1:646799484931:parameter/cdk-bootstrap/hnb659fds/version"
      ]
    },
    {
      "Sid": "ReadStackOutputs",
      "Effect": "Allow",
      "Action": ["cloudformation:DescribeStacks"],
      "Resource": [
        "arn:aws:cloudformation:ap-south-1:646799484931:stack/SnapUrl/*",
        "arn:aws:cloudformation:us-east-1:646799484931:stack/SnapUrlCert/*"
      ]
    },
    {
      "Sid": "DeployScriptPostVerify",
      "Effect": "Allow",
      "Action": ["ec2:DescribeSecurityGroups"],
      "Resource": "*"
    },
    {
      "Sid": "InvokeWorkerForMigrations",
      "Effect": "Allow",
      "Action": "lambda:InvokeFunction",
      "Resource": "arn:aws:lambda:ap-south-1:646799484931:function:SnapUrl-WorkerFn*"
    }
  ]
}
```

Why each of the last three exists — none is CDK's, all are ours:

| Statement | Needed by |
| --- | --- |
| `ReadStackOutputs` | The deploy job reads `ApiUrl` / `RedirectDomain` / `WorkerFunctionName` to target the smoke gate at what was just deployed. |
| `DeployScriptPostVerify` | `infra/deploy.sh` asserts NAT egress survived the deploy via `ec2:DescribeSecurityGroups`. This API does not support resource-level permissions, hence `"*"` — it is read-only. |
| `InvokeWorkerForMigrations` | Migrations only run by invoking the worker; RDS is unreachable from outside the VPC. |

## 4. GitHub configuration

### Environment

Create an environment named **`production`** (Settings → Environments):

- **Required reviewers: yourself.** This is the approval gate. It is what makes
  "always `cdk diff` before deploying" and "deploys are user-triggered, never
  autonomous" structural rather than a habit — the `deploy` job waits here while
  you read the diff the `plan` job wrote to the run summary.
- Optionally restrict deployment branches to `main`.

### Variables

Repository or `production`-environment **variables** (Settings → Variables).
All five are non-secret and belong in variables, not secrets — putting a
non-secret in a secret only makes it unreadable in logs when you need it.

| Variable | Value |
| --- | --- |
| `AWS_DEPLOY_ROLE_ARN` | `arn:aws:iam::646799484931:role/snapurl-github-deploy` |
| `AWS_PLAN_ROLE_ARN` | `arn:aws:iam::646799484931:role/snapurl-github-plan` |
| `AWS_ACCOUNT_ID` | `646799484931` |
| `DOMAIN_NAME` | `snapurl.in` |
| `BUDGET_EMAIL` | the billing-alert address |
| `GOOGLE_OAUTH_CLIENT_ID` | the **public** OAuth client id |

> If you scope these as *environment* variables on `production` rather than
> repository variables, `AWS_PLAN_ROLE_ARN` must still be a **repository**
> variable — the `plan` job has no environment and would read it as empty.

> `BUDGET_EMAIL` and `GOOGLE_OAUTH_CLIENT_ID` are not decoration. Omitting the
> first destroys the budget and SNS cost alarms; omitting the second strips
> OAuth from the API Lambda. Both have been caught by a diff before being
> applied. If either variable is unset the deploy proceeds without that flag and
> the diff will show the deletion — which is why the plan job annotates
> destructive changes as a warning.

### Secrets

None are required. The smoke gate self-registers a throwaway user. Only if open
registration is ever disabled in production do you add `smoke_email` /
`smoke_password` and pass `secrets: inherit` to the smoke job.

## 5. First run

1. Actions → **Deploy (AWS)** → Run workflow, leaving `stack` as `SnapUrl`.
2. `plan` runs and writes the diff to the run summary. **Read it.** Confirm it
   contains only what you intended and no unexpected deletion.
3. Approve the `production` environment prompt. `deploy` applies it.
4. `smoke` runs `scripts/smoke-redirect.sh` against the freshly-deployed URLs.
   If it fails, the deploy is not successful, regardless of what CloudFormation
   reported.

Tick `run_migrations` only when a deploy ships new migration files.

## Notes and deliberate choices

- **`ubuntu-24.04-arm` runners.** The Lambdas are arm64/Graviton, so an x86
  runner would need QEMU and take roughly ten times as long. These runners are
  free for public repositories. If they are ever unavailable, add
  `docker/setup-qemu-action@v3` and switch to `ubuntu-latest`, accepting the
  slowdown.
- **Actions are pinned to major tags** (`@v4`), matching every existing workflow
  in this repo and keeping Dependabot able to bump them. Pinning to full commit
  SHAs is stricter against a compromised action and is worth considering for
  this workflow specifically, since it is the one that holds AWS credentials.
- **The images build twice** (once per synth in `plan` and `deploy`). This is the
  cost of putting the human approval between a readable diff and the apply.
  Native arm64 makes it cheap, and CDK skips pushing any digest already in ECR.
- **No `push` trigger.** Deploys are dispatch-only by policy.
