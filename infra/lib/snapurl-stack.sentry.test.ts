import { App } from "aws-cdk-lib";
import { Template } from "aws-cdk-lib/assertions";
import { beforeAll, describe, expect, it } from "vitest";
import { SnapUrlStack } from "./snapurl-stack.js";

/**
 * #995 — opt-in Sentry DSN: with `sentryDsnSecretName` set, ALL THREE functions
 * (api, redirect, worker) get the secret's name in SENTRY_DSN_SECRET_ARN plus
 * read access to it — because each reports its own crashes — and a passed
 * `sentryRelease` lands as a plain SENTRY_RELEASE env var on all three. Without
 * them the stack is unchanged and error tracking stays off. One full synth
 * (see snapurl-stack.nat.test.ts on why one per file).
 */

const SECRET_NAME = "snapurl/test/sentry-dsn";
const RELEASE = "snapurl@2.0.0+testsha";

describe("SnapUrlStack — opt-in Sentry DSN", () => {
  let template: Template;

  beforeAll(() => {
    template = Template.fromStack(
      new SnapUrlStack(new App(), "TestStack", {
        env: { account: "111111111111", region: "us-east-1" },
        configPrefix: "/test/snapurl",
        natStrategy: "instance",
        natAmiIds: { "us-east-1": "ami-0123456789abcdef0" },
        sentryDsnSecretName: SECRET_NAME,
        sentryRelease: RELEASE,
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

  it("sets SENTRY_DSN_SECRET_ARN and SENTRY_RELEASE on all three functions", () => {
    const { env } = functionsByPrefix();
    for (const fn of ["ApiFn", "RedirectFn", "WorkerFn"]) {
      expect(env(fn).SENTRY_DSN_SECRET_ARN).toBe(SECRET_NAME);
      expect(env(fn).SENTRY_RELEASE).toBe(RELEASE);
      // The DSN value itself never lands in the template.
      expect(env(fn).SENTRY_DSN).toBeUndefined();
    }
  });

  it("grants every function's role GetSecretValue on the Sentry secret", () => {
    const { role } = functionsByPrefix();
    const grantedRoles = Object.values(template.findResources("AWS::IAM::Policy"))
      .filter((p) =>
        (p.Properties.PolicyDocument.Statement as { Action: unknown; Resource: unknown }[]).some(
          (st) =>
            JSON.stringify(st.Resource).includes(`secret:${SECRET_NAME}`) &&
            JSON.stringify(st.Action).includes("secretsmanager:GetSecretValue"),
        ),
      )
      .flatMap((p) => (p.Properties.Roles as { Ref: string }[]).map((r) => r.Ref));
    expect(grantedRoles.sort()).toEqual([role("ApiFn"), role("RedirectFn"), role("WorkerFn")].sort());
  });
});

describe("SnapUrlStack — Sentry off by default", () => {
  it("sets no Sentry env when sentryDsnSecretName is unset", () => {
    const template = Template.fromStack(
      new SnapUrlStack(new App(), "TestStackNoSentry", {
        env: { account: "111111111111", region: "us-east-1" },
        configPrefix: "/test/snapurl",
        natStrategy: "instance",
        natAmiIds: { "us-east-1": "ami-0123456789abcdef0" },
      }),
    );
    const fns = template.findResources("AWS::Lambda::Function");
    for (const [, fn] of Object.entries(fns)) {
      const vars = (fn.Properties.Environment?.Variables ?? {}) as Record<string, unknown>;
      expect(vars.SENTRY_DSN_SECRET_ARN).toBeUndefined();
    }
  });
});
