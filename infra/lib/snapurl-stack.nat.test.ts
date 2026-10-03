import { App, Stack, Token } from "aws-cdk-lib";
import { Annotations, Match, Template } from "aws-cdk-lib/assertions";
import { beforeAll, describe, expect, it } from "vitest";
import { SnapUrlStack, natInstanceMachineImage } from "./snapurl-stack.js";

/**
 * NAT instance and cold-start egress.
 *
 * Production's API went down after a routine deploy: the NAT instance's AMI
 * floated to "latest AL2023", so a new AL2023 release replaced the instance;
 * the replacement's `yum install iptables-services` was OOM-killed on a
 * t4g.nano, it never configured masquerading, and every Lambda egress call —
 * including the cold-start Secrets Manager fetch the API cannot boot without —
 * hung until timeout. These assertions pin each of the three fixes:
 *
 * - the AMI comes from the per-region `natAmiIds` pin, not a floating lookup;
 * - the instance is a t4g.micro, which has room for the user data's dnf run;
 * - Secrets Manager is reachable through a VPC interface endpoint, so the
 *   API's boot no longer depends on the NAT instance at all.
 *
 * One full synth only (~25-45s of blocking work, see the cache-bust test's
 * header): several in one file starve the vitest worker's RPC and fail the
 * run. The 'none' topology is checked in snapurl-stack.nat-none.test.ts.
 */

const PINNED = "ami-0123456789abcdef0";

describe("natInstanceMachineImage", () => {
  const imageIdIn = (region: string, natAmiIds?: Record<string, string>) => {
    const stack = new Stack(new App(), "S", { env: { account: "111111111111", region } });
    const { image, pinnedAmi } = natInstanceMachineImage(stack.region, natAmiIds);
    return { pinnedAmi, imageId: image.getImage(stack).imageId };
  };

  it("uses the pinned AMI for a region that has one", () => {
    expect(imageIdIn("us-east-1", { "us-east-1": PINNED })).toEqual({ pinnedAmi: PINNED, imageId: PINNED });
  });

  it("falls back to the floating AL2023 image for a region with no pin", () => {
    const { pinnedAmi, imageId } = imageIdIn("us-east-1", { "eu-west-1": PINNED });
    expect(pinnedAmi).toBeUndefined();
    // The floating image resolves through an SSM parameter at deploy time.
    expect(Token.isUnresolved(imageId)).toBe(true);
  });

  it("does not pin when the region is a token", () => {
    expect(natInstanceMachineImage(Token.asString({ Ref: "AWS::Region" }), { "us-east-1": PINNED }).pinnedAmi)
      .toBeUndefined();
  });
});

describe("SnapUrlStack — NAT instance and Secrets Manager reachability", () => {
  let stack: SnapUrlStack;
  let template: Template;

  beforeAll(() => {
    stack = new SnapUrlStack(new App(), "TestStack", {
      env: { account: "111111111111", region: "us-east-1" },
      configPrefix: "/test/snapurl",
      natStrategy: "instance",
      natAmiIds: { "us-east-1": PINNED },
    });
    template = Template.fromStack(stack);
  }, 120_000);

  it("launches the NAT instance from the pinned AMI on a t4g.micro", () => {
    template.hasResourceProperties("AWS::EC2::Instance", {
      ImageId: PINNED,
      InstanceType: "t4g.micro",
      SourceDestCheck: false,
    });
  });

  it("does not warn that the NAT AMI is unpinned", () => {
    const warnings = Annotations.fromStack(stack).findWarning("*", Match.stringLikeRegexp("NAT instance AMI is not pinned"));
    expect(warnings).toHaveLength(0);
  });

  it("gives the egress subnets a Secrets Manager interface endpoint with private DNS, in one AZ", () => {
    template.hasResourceProperties("AWS::EC2::VPCEndpoint", {
      VpcEndpointType: "Interface",
      ServiceName: "com.amazonaws.us-east-1.secretsmanager",
      PrivateDnsEnabled: true,
    });
    // One AZ only: the endpoint is billed per AZ.
    const endpoints = template.findResources("AWS::EC2::VPCEndpoint", {
      Properties: { VpcEndpointType: "Interface" },
    });
    const [endpoint] = Object.values(endpoints) as { Properties: { SubnetIds: unknown[] } }[];
    expect(Object.keys(endpoints)).toHaveLength(1);
    expect(endpoint!.Properties.SubnetIds).toHaveLength(1);
  });
});
