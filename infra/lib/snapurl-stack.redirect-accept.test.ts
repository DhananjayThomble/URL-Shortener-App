import { App } from "aws-cdk-lib";
import { Template } from "aws-cdk-lib/assertions";
import { beforeAll, describe, expect, it } from "vitest";
import { SnapUrlStack } from "./snapurl-stack.js";

/**
 * Oracle (#766): the redirect picks its dead-end response (branded HTML for
 * browsers, legacy plain text otherwise) from the viewer's Accept header. On
 * the AWS profile the origin only sees the headers RedirectOrigReqPolicy
 * allow-lists, so `accept` must be forwarded or every visitor behind the CDN
 * gets plain text. It must NOT enter the cache key: the error responses are
 * `no-store` and successful redirects must not fragment by browser Accept.
 */
describe("SnapUrlStack — redirect origin receives Accept (#766)", () => {
  let template: Template;

  beforeAll(() => {
    const app = new App();
    const stack = new SnapUrlStack(app, "TestStack", {
      env: { account: "111111111111", region: "us-east-1" },
      configPrefix: "/test/snapurl",
      natStrategy: "none",
    });
    template = Template.fromStack(stack);
  }, 120_000);

  it("forwards accept to the redirect origin", () => {
    const policies = Object.values(template.findResources("AWS::CloudFront::OriginRequestPolicy"));
    expect(policies).toHaveLength(1);
    const headers = policies[0].Properties.OriginRequestPolicyConfig.HeadersConfig;
    expect(headers.HeaderBehavior).toBe("whitelist");
    expect(headers.Headers).toEqual(
      expect.arrayContaining(["accept", "accept-language", "user-agent", "x-forwarded-host"]),
    );
  });

  it("keeps headers out of the redirect cache key", () => {
    const policies = template.findResources("AWS::CloudFront::CachePolicy");
    const redirect = Object.values(policies).find((p) =>
      String(p.Properties.CachePolicyConfig.Comment ?? "").includes("redirects"),
    );
    expect(redirect).toBeDefined();
    expect(
      redirect!.Properties.CachePolicyConfig.ParametersInCacheKeyAndForwardedToOrigin.HeadersConfig.HeaderBehavior,
    ).toBe("none");
  });
});
