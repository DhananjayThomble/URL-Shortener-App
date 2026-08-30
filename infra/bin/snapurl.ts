#!/usr/bin/env node
import { App } from "aws-cdk-lib";
import { SnapUrlStack } from "../lib/snapurl-stack.js";

/* Region and account come from the CLI environment, not from this file, so
   the same stack can be synthesised by anyone without editing it. */
const app = new App();

new SnapUrlStack(app, "SnapUrl", {
  env: {
    account: process.env.CDK_DEFAULT_ACCOUNT,
    // ap-south-1 (Mumbai) matches the project's timezone and its users.
    region: process.env.CDK_DEFAULT_REGION ?? "ap-south-1",
  },
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
  description: "SnapURL: API, redirect service, worker, and the Postgres they share.",
  tags: {
    Project: "SnapURL",
    ManagedBy: "CDK",
  },
});
