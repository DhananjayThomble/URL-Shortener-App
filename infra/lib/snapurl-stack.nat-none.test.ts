import { App } from "aws-cdk-lib";
import { Template } from "aws-cdk-lib/assertions";
import { beforeAll, describe, it } from "vitest";
import { SnapUrlStack } from "./snapurl-stack.js";

/**
 * The free zero-egress topology must stay free: the Secrets Manager interface
 * endpoint (~$7/month) added for the NAT profiles is not created under
 * `natStrategy: 'none'`, which never sets the *_SECRET_ARN vars anyway. Its
 * own file because each full synth needs its own vitest worker (see
 * snapurl-stack.nat.test.ts).
 */
describe("SnapUrlStack — natStrategy 'none'", () => {
  let template: Template;

  beforeAll(() => {
    template = Template.fromStack(
      new SnapUrlStack(new App(), "TestStack", {
        env: { account: "111111111111", region: "us-east-1" },
        configPrefix: "/test/snapurl",
        natStrategy: "none",
      }),
    );
  }, 120_000);

  it("adds no interface endpoint and no NAT instance", () => {
    template.resourcePropertiesCountIs("AWS::EC2::VPCEndpoint", { VpcEndpointType: "Interface" }, 0);
    template.resourceCountIs("AWS::EC2::Instance", 0);
  });
});
