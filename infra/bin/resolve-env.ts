import type { App } from "aws-cdk-lib";

/**
 * Resolves the CDK environment (account/region) for `bin/snapurl.ts`, from
 * explicit `-c account=`/`-c region=` context ONLY — never from
 * `CDK_DEFAULT_ACCOUNT`/`CDK_DEFAULT_REGION`.
 *
 * Those two env vars look like a reasonable hermetic default, but they are
 * not: the `cdk` CLI injects both into the app's process env on EVERY
 * invocation, populated from whatever ambient AWS credentials it can find
 * (an instance role, a CI runner's OIDC-assumed role, anything) —
 * unconditionally, regardless of whether the invoking shell exported them
 * itself. Reading them here would make a bare `cdk synth` behave differently
 * depending on the ambient identity of whoever runs it, and specifically
 * would give the stack a concrete `account`, which makes `ec2.Vpc`'s
 * `maxAzs` validate against `Stack.availabilityZones` and perform a live
 * `ec2:DescribeAvailabilityZones` call — see issue #481.
 *
 * `account` is left `undefined` unless `-c account=` is passed. `region`
 * always resolves to something concrete (defaulting to `ap-south-1`):
 * CDK only skips the AZ-lookup context query when `account` is absent, and
 * a concrete `region` is what lets the `SnapUrlCert`/`SnapUrl` stack pair in
 * `bin/snapurl.ts` keep resolving to a fixed `us-east-1`/`ap-south-1` (or
 * whatever `-c region=` says) even on the fully offline synth path — see
 * `docs/DEPLOYMENT.md`'s note on the CloudFront certificate needing
 * `us-east-1` regardless of the rest of the stack's region.
 */
export function resolveEnv(app: App): { account: string | undefined; region: string } {
  const account = app.node.tryGetContext("account") as string | undefined;
  // ap-south-1 (Mumbai) matches the project's timezone and its users.
  const region = (app.node.tryGetContext("region") as string | undefined) ?? "ap-south-1";
  return { account, region };
}
