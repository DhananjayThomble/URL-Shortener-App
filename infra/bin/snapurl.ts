#!/usr/bin/env node
import { App, Stack } from "aws-cdk-lib";
import * as acm from "aws-cdk-lib/aws-certificatemanager";
import { SnapUrlStack } from "../lib/snapurl-stack.js";

/* Region and account come from the CLI environment, not from this file, so
   the same stack can be synthesised by anyone without editing it. */
const app = new App();

/* `-c account=...`/`-c region=...` are the ONLY way to give this stack a
   concrete environment. Reading `CDK_DEFAULT_ACCOUNT`/`CDK_DEFAULT_REGION`
   does not work as a hermetic default: the `cdk` CLI injects both into the
   app's process env on EVERY invocation, populated from whatever ambient AWS
   credentials it can find (an instance role, a CI runner's OIDC-assumed
   role, anything) — unconditionally, regardless of whether the invoking
   shell exported them itself. That made every stack env-specific the moment
   a host had *any* AWS identity, which is exactly what makes `ec2.Vpc`
   (`lib/snapurl-stack.ts`) validate its pinned `availabilityZones` against
   `Stack.availabilityZones`, triggering a live `ec2:DescribeAvailabilityZones`
   context lookup during plain `cdk synth` — and failing outright if that
   identity lacks the permission, on a system that is not supposed to need
   any AWS access to synth at all (issue #481). deploy.sh passes
   `-c account=`/`-c region=` explicitly (still sourced from the same
   CDK_DEFAULT_ACCOUNT/CDK_DEFAULT_REGION env vars an operator already sets)
   for a real deploy. Left unset — the default for a bare `cdk synth`, an
   agent's or a contributor's case, and the one issue #481 is about — `env`
   stays fully undefined, so the stack is environment-agnostic and CDK fills
   in deterministic dummy AZs instead of asking AWS.

   NOTE: `.github/workflows/deploy-aws.yml`'s `plan` job invokes `cdk diff`
   directly (not via deploy.sh) and currently relies on the ambient
   CDK_DEFAULT_ACCOUNT/CDK_DEFAULT_REGION injection this change removes — it
   needs a matching `-c account=`/`-c region=` update to keep working. Left
   unchanged here because the agent making this fix does not have the
   `workflow` OAuth scope needed to push a `.github/workflows/*` change (same
   constraint as issue #480); flagged in the PR for the maintainer. */
const account = app.node.tryGetContext("account") as string | undefined;
// ap-south-1 (Mumbai) matches the project's timezone and its users. Only
// takes effect once `account` above is also set — see the env object below.
const region = (app.node.tryGetContext("region") as string | undefined) ?? "ap-south-1";
// `env` must be fully undefined (not `{ account: undefined, region }`) for
// CDK to treat the stack as environment-agnostic — a partially-set env still
// forces context lookups for the parts left unresolved.
const env = account ? { account, region } : undefined;

/* Custom domain on the CloudFront distribution (the redirect/short-link
   edge). Optional — unset means the raw *.cloudfront.net hostname, exactly
   the prior behaviour. Set with `-c domainName=snapurl.in`.

   CloudFront's certificate MUST live in us-east-1 regardless of which region
   the rest of the stack deploys to (a CloudFront/ACM requirement, not a
   choice made here) — so when a domain is given, a second small Stack pinned
   to us-east-1 holds just the Certificate, and `crossRegionReferences: true`
   on both stacks lets the main stack (region above) consume that us-east-1
   resource. DNS validation is used rather than Route53 validation: this
   project's DNS does not have to be on Route53 (Cloudflare, for one, works
   fine) — `cdk deploy` will pause on the certificate resource printing the
   CNAME record to add wherever the domain's DNS actually lives, and resume
   once ACM sees it resolve. */
const domainName = app.node.tryGetContext("domainName") as string | undefined;

let certificate: acm.ICertificate | undefined;
if (domainName) {
  const certStack = new Stack(app, "SnapUrlCert", {
    env: env ? { account: env.account, region: "us-east-1" } : undefined,
    crossRegionReferences: true,
    description: "us-east-1 ACM certificate for the SnapUrl CloudFront distribution (CloudFront's own requirement).",
  });
  certificate = new acm.Certificate(certStack, "Certificate", {
    domainName,
    validation: acm.CertificateValidation.fromDns(),
  });
}

new SnapUrlStack(app, "SnapUrl", {
  env,
  // Required alongside the cert stack's own flag whenever this stack
  // references a construct (the certificate) created in a different region.
  crossRegionReferences: Boolean(domainName),
  /* Which set of Parameter Store values this deploy reads. One prefix per
     stage, so a staging deploy cannot pick up production's origins. */
  configPrefix: app.node.tryGetContext("configPrefix") ?? "/snapurl/prod",
  /* Both optional. Left unset they come from Parameter Store, which is the
     normal case — set once, not retyped on every deploy. Passing one overrides
     the stored value for this deploy only, which is what a preview origin
     wants. Getting either wrong shows up as every dashboard panel rendering
     empty with a CORS error in the console. */
  webOrigin: app.node.tryGetContext("webOrigin"),
  redirectOrigin: app.node.tryGetContext("redirectOrigin"),
  /* A topology/synth-time choice (it shapes the VPC), not deploy-time config,
     so it lives here and not in SSM. Defaults to 'instance' (t4g.nano NAT
     instance, ~$3/mo) inside the stack; override with `-c natStrategy=gateway`
     (managed NAT, ~$32/mo) or `-c natStrategy=none` (free, no egress). Context
     is untyped, so the stack validates it and throws on anything else. */
  natStrategy: app.node.tryGetContext("natStrategy"),
  /* Where AWS Budgets alarms are delivered. Optional and deploy-time (a per-
     deploy destination, not stage config), so it lives here rather than SSM.
     Left unset, the budget + SNS topic are not created and the stack still
     deploys; set it with `-c budgetEmail=you@example.com` to turn the $25/$50/
     $75 spend alarms on. */
  budgetEmail: app.node.tryGetContext("budgetEmail"),
  domainName,
  certificate,
  /* Optional, same shape as budgetEmail: unset means the Google sign-in
     button on the frontend renders (it only checks its own
     NEXT_PUBLIC_GOOGLE_CLIENT_ID) but every attempt fails server-side, since
     OAuthService.enabled('google') has nothing to check the ID token's
     audience against. Set with
     `-c googleOAuthClientId=<id>.apps.googleusercontent.com`, matching the
     Google Cloud Console client's id exactly, and matching
     NEXT_PUBLIC_GOOGLE_CLIENT_ID on the frontend. */
  googleOAuthClientId: app.node.tryGetContext("googleOAuthClientId"),
  /* The commit this deploy was built from, surfaced as the DeployedGitSha
     output. Set by CI (`-c deployedGitSha=<sha>`); omitted locally, in which
     case the output is simply not created. Answering "which commit is live?"
     is a precondition for rollback — see docs/ROLLBACK.md. */
  deployedGitSha: app.node.tryGetContext("deployedGitSha"),
  description: "SnapURL: API, redirect service, worker, and the Postgres they share.",
  tags: {
    Project: "SnapURL",
    ManagedBy: "CDK",
  },
});
