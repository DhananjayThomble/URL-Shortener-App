import { App } from "aws-cdk-lib";
import { Template } from "aws-cdk-lib/assertions";
import { beforeAll, describe, expect, it } from "vitest";
import { SnapUrlStack } from "./snapurl-stack.js";

/**
 * #973 — the platform-analytics email tile reads the account's SES figures, so
 * the API Lambda role carries the two read-only account actions
 * (ses:GetSendStatistics, ses:GetSendQuota) on "*", and NO other function's
 * role does. This is a separate, account-level statement from the
 * identity-scoped SendEmail grant. One full synth (see snapurl-stack.nat.test.ts
 * on why one per file).
 */

const SES_READ_ACTIONS = ["ses:GetSendStatistics", "ses:GetSendQuota"];

describe("SnapUrlStack — SES read grant for platform analytics (#973)", () => {
  let template: Template;

  beforeAll(() => {
    template = Template.fromStack(
      new SnapUrlStack(new App(), "TestStack", {
        env: { account: "111111111111", region: "us-east-1" },
        configPrefix: "/test/snapurl",
        natStrategy: "instance",
        natAmiIds: { "us-east-1": "ami-0123456789abcdef0" },
      }),
    );
  }, 120_000);

  /** The role logical-id (Fn::GetAtt target) of the function whose logical id
   *  starts with `prefix`. */
  const roleOf = (prefix: string): string => {
    const fns = template.findResources("AWS::Lambda::Function");
    return Object.entries(fns).find(([id]) => id.startsWith(prefix))![1].Properties.Role["Fn::GetAtt"][0] as string;
  };

  /** Roles carrying a statement that allows BOTH SES read actions on "*". */
  const rolesWithSesRead = (): string[] =>
    Object.values(template.findResources("AWS::IAM::Policy"))
      .filter((p) =>
        (p.Properties.PolicyDocument.Statement as { Action: unknown; Resource: unknown }[]).some((st) => {
          const actions = JSON.stringify(st.Action);
          return SES_READ_ACTIONS.every((a) => actions.includes(a)) && JSON.stringify(st.Resource) === '"*"';
        }),
      )
      .flatMap((p) => (p.Properties.Roles as { Ref: string }[]).map((r) => r.Ref));

  it("grants ApiFn's role both SES read actions on '*'", () => {
    expect(rolesWithSesRead()).toEqual([roleOf("ApiFn")]);
  });

  it("does not grant the redirect or worker roles the SES read actions", () => {
    const granted = rolesWithSesRead();
    expect(granted).not.toContain(roleOf("RedirectFn"));
    expect(granted).not.toContain(roleOf("WorkerFn"));
  });
});
