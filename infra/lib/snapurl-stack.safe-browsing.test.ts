import { App } from "aws-cdk-lib";
import { Template } from "aws-cdk-lib/assertions";
import { beforeAll, describe, expect, it } from "vitest";
import { SnapUrlStack } from "./snapurl-stack.js";

/**
 * Opt-in Safe Browsing key: with `safeBrowsingSecretName` set, the API (and
 * only the API) gets the secret's name in GOOGLE_SAFE_BROWSING_API_KEY_SECRET_ARN
 * plus read access to it. Without it, the stack is unchanged and Safe Browsing
 * stays off. One full synth (see snapurl-stack.nat.test.ts on why one per file).
 */

const SECRET_NAME = "snapurl/test/google-safe-browsing-api-key";

describe("SnapUrlStack — opt-in Safe Browsing API key", () => {
  let template: Template;

  beforeAll(() => {
    template = Template.fromStack(
      new SnapUrlStack(new App(), "TestStack", {
        env: { account: "111111111111", region: "us-east-1" },
        configPrefix: "/test/snapurl",
        natStrategy: "instance",
        natAmiIds: { "us-east-1": "ami-0123456789abcdef0" },
        safeBrowsingSecretName: SECRET_NAME,
      }),
    );
  }, 120_000);

  const functionsByPrefix = () => {
    const fns = template.findResources("AWS::Lambda::Function");
    const env = (prefix: string) =>
      (Object.entries(fns).find(([id]) => id.startsWith(prefix))![1].Properties.Environment?.Variables ?? {}) as Record<
        string,
        unknown
      >;
    const role = (prefix: string) =>
      Object.entries(fns).find(([id]) => id.startsWith(prefix))![1].Properties.Role["Fn::GetAtt"][0] as string;
    return { env, role };
  };

  it("gives ApiFn the secret's name, and no other function", () => {
    const { env } = functionsByPrefix();
    expect(env("ApiFn").GOOGLE_SAFE_BROWSING_API_KEY_SECRET_ARN).toBe(SECRET_NAME);
    expect(env("RedirectFn").GOOGLE_SAFE_BROWSING_API_KEY_SECRET_ARN).toBeUndefined();
    expect(env("WorkerFn").GOOGLE_SAFE_BROWSING_API_KEY_SECRET_ARN).toBeUndefined();
    // The key itself never lands in the template.
    expect(env("ApiFn").GOOGLE_SAFE_BROWSING_API_KEY).toBeUndefined();
  });

  it("grants only ApiFn's role secretsmanager:GetSecretValue on that secret", () => {
    const { role } = functionsByPrefix();
    const grantsOnSecret = Object.values(template.findResources("AWS::IAM::Policy"))
      .filter((p) =>
        (p.Properties.PolicyDocument.Statement as { Action: unknown; Resource: unknown }[]).some(
          (st) =>
            JSON.stringify(st.Resource).includes(`secret:${SECRET_NAME}`) &&
            JSON.stringify(st.Action).includes("secretsmanager:GetSecretValue"),
        ),
      )
      .flatMap((p) => (p.Properties.Roles as { Ref: string }[]).map((r) => r.Ref));
    expect(grantsOnSecret).toEqual([role("ApiFn")]);
  });
});
