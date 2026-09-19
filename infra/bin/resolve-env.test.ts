import { App } from "aws-cdk-lib";
import { describe, expect, it } from "vitest";
import { resolveEnv } from "./resolve-env.js";

/**
 * Regression coverage for issue #481: `cdk synth` performed a live
 * `ec2:DescribeAvailabilityZones` call and failed on any host with an
 * ambient AWS identity lacking that permission, because `bin/snapurl.ts`
 * read `CDK_DEFAULT_ACCOUNT`/`CDK_DEFAULT_REGION` — env vars the `cdk` CLI
 * injects into the app's process env on every invocation regardless of what
 * the invoking shell set. `resolveEnv` must read `account`/`region` from
 * CDK context ONLY, never from those env vars, so bare `cdk synth` stays
 * hermetic. Run against `main`'s equivalent logic (reading the env vars
 * directly) this suite fails: with the env vars populated, `account` comes
 * back set and `-c account=`/`-c region=` context is ignored.
 */
describe("resolveEnv", () => {
  it("does not read CDK_DEFAULT_ACCOUNT / CDK_DEFAULT_REGION even when the cdk CLI has injected them", () => {
    const original = {
      account: process.env.CDK_DEFAULT_ACCOUNT,
      region: process.env.CDK_DEFAULT_REGION,
    };
    // Simulates what the `cdk` CLI does on every invocation: injects both
    // vars from whatever ambient AWS identity it finds, unconditionally.
    process.env.CDK_DEFAULT_ACCOUNT = "111111111111";
    process.env.CDK_DEFAULT_REGION = "us-west-2";
    try {
      const app = new App();
      const { account, region } = resolveEnv(app);

      // account must stay undefined: no -c account= was passed, and the
      // injected env var must not leak in as a fallback.
      expect(account).toBeUndefined();
      // region falls back to the project default, not the injected env var.
      expect(region).toBe("ap-south-1");
    } finally {
      process.env.CDK_DEFAULT_ACCOUNT = original.account;
      process.env.CDK_DEFAULT_REGION = original.region;
    }
  });

  it("resolves account/region from explicit -c account=/-c region= context", () => {
    const app = new App({
      context: { account: "222222222222", region: "eu-west-1" },
    });
    const { account, region } = resolveEnv(app);

    expect(account).toBe("222222222222");
    expect(region).toBe("eu-west-1");
  });

  it("leaves account undefined and region defaulted when no context and no env vars are present", () => {
    const original = {
      account: process.env.CDK_DEFAULT_ACCOUNT,
      region: process.env.CDK_DEFAULT_REGION,
    };
    delete process.env.CDK_DEFAULT_ACCOUNT;
    delete process.env.CDK_DEFAULT_REGION;
    try {
      const app = new App();
      const { account, region } = resolveEnv(app);

      expect(account).toBeUndefined();
      expect(region).toBe("ap-south-1");
    } finally {
      if (original.account !== undefined) process.env.CDK_DEFAULT_ACCOUNT = original.account;
      if (original.region !== undefined) process.env.CDK_DEFAULT_REGION = original.region;
    }
  });
});
