#!/usr/bin/env node
import { App, Stack } from "aws-cdk-lib";
import * as acm from "aws-cdk-lib/aws-certificatemanager";
import { SnapUrlStack } from "../lib/snapurl-stack.js";

/* Region and account come from the CLI environment, not from this file, so
   the same stack can be synthesised by anyone without editing it. */
const app = new App();

const account = process.env.CDK_DEFAULT_ACCOUNT;
// ap-south-1 (Mumbai) matches the project's timezone and its users.
const region = process.env.CDK_DEFAULT_REGION ?? "ap-south-1";

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
    env: { account, region: "us-east-1" },
    crossRegionReferences: true,
    description: "us-east-1 ACM certificate for the SnapUrl CloudFront distribution (CloudFront's own requirement).",
  });
  certificate = new acm.Certificate(certStack, "Certificate", {
    domainName,
    validation: acm.CertificateValidation.fromDns(),
  });
}

new SnapUrlStack(app, "SnapUrl", {
  env: { account, region },
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
  description: "SnapURL: API, redirect service, worker, and the Postgres they share.",
  tags: {
    Project: "SnapURL",
    ManagedBy: "CDK",
  },
});
