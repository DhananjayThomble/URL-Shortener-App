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
  // Where the dashboard is served from. CORS on the API allows this origin
  // and no other, so a wrong value here shows up as every panel rendering
  // empty with a CORS error in the console.
  webOrigin: app.node.tryGetContext("webOrigin") ?? "http://localhost:3000",
  redirectOrigin: app.node.tryGetContext("redirectOrigin") ?? "http://localhost:3002",
  description: "SnapURL: API, redirect service, worker, and the Postgres they share.",
  tags: {
    Project: "SnapURL",
    ManagedBy: "CDK",
  },
});
