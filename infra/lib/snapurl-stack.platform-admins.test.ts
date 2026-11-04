import { App } from "aws-cdk-lib";
import { Template } from "aws-cdk-lib/assertions";
import { beforeAll, describe, expect, it } from "vitest";
import { SnapUrlStack } from "./snapurl-stack.js";

/**
 * #968 — the platform-admin allowlist reaches the API Lambda ONLY.
 *
 * With `platformAdminEmails` set, PLATFORM_ADMIN_EMAILS lands on ApiFn's
 * environment and nowhere else (the redirect and worker never serve /admin).
 * Without it, no function carries the key — an unset allowlist is "no admins",
 * exactly as apps/api/src/config/env.ts reads an absent value. One full synth
 * per case (see snapurl-stack.nat.test.ts on why one per file).
 */

const EMAILS = "admin@example.com,ops@example.com";

function envByPrefix(template: Template) {
  const fns = template.findResources("AWS::Lambda::Function");
  return (prefix: string) =>
    (Object.entries(fns).find(([id]) => id.startsWith(prefix))![1].Properties.Environment?.Variables ?? {}) as Record<
      string,
      unknown
    >;
}

describe("SnapUrlStack — platform-admin allowlist (#968)", () => {
  describe("with platformAdminEmails set", () => {
    let env: (prefix: string) => Record<string, unknown>;

    beforeAll(() => {
      const template = Template.fromStack(
        new SnapUrlStack(new App(), "TestStack", {
          env: { account: "111111111111", region: "us-east-1" },
          configPrefix: "/test/snapurl",
          natStrategy: "instance",
          natAmiIds: { "us-east-1": "ami-0123456789abcdef0" },
          platformAdminEmails: EMAILS,
        }),
      );
      env = envByPrefix(template);
    }, 120_000);

    it("gives ApiFn PLATFORM_ADMIN_EMAILS, and no other function", () => {
      expect(env("ApiFn").PLATFORM_ADMIN_EMAILS).toBe(EMAILS);
      expect(env("RedirectFn").PLATFORM_ADMIN_EMAILS).toBeUndefined();
      expect(env("WorkerFn").PLATFORM_ADMIN_EMAILS).toBeUndefined();
    });
  });

  describe("without platformAdminEmails", () => {
    let env: (prefix: string) => Record<string, unknown>;

    beforeAll(() => {
      const template = Template.fromStack(
        new SnapUrlStack(new App(), "TestStackNoAdmins", {
          env: { account: "111111111111", region: "us-east-1" },
          configPrefix: "/test/snapurl",
          natStrategy: "instance",
          natAmiIds: { "us-east-1": "ami-0123456789abcdef0" },
        }),
      );
      env = envByPrefix(template);
    }, 120_000);

    it("leaves PLATFORM_ADMIN_EMAILS unset on every function", () => {
      expect(env("ApiFn").PLATFORM_ADMIN_EMAILS).toBeUndefined();
      expect(env("RedirectFn").PLATFORM_ADMIN_EMAILS).toBeUndefined();
      expect(env("WorkerFn").PLATFORM_ADMIN_EMAILS).toBeUndefined();
    });
  });

  describe("with platformAdminEmailsFromSsm (#1050)", () => {
    let template: Template;
    let env: (prefix: string) => Record<string, unknown>;

    beforeAll(() => {
      template = Template.fromStack(
        new SnapUrlStack(new App(), "TestStackSsmAdmins", {
          env: { account: "111111111111", region: "us-east-1" },
          configPrefix: "/test/snapurl",
          natStrategy: "instance",
          natAmiIds: { "us-east-1": "ami-0123456789abcdef0" },
          platformAdminEmailsFromSsm: true,
        }),
      );
      env = envByPrefix(template);
    }, 120_000);

    it("resolves PLATFORM_ADMIN_EMAILS on ApiFn from SSM <prefix>/platform-admin-emails, via CloudFormation", () => {
      const params = template.toJSON().Parameters as Record<string, { Type: string; Default: string }>;
      const [logicalId] = Object.entries(params).find(
        ([, p]) => p.Type === "AWS::SSM::Parameter::Value<String>" && p.Default === "/test/snapurl/platform-admin-emails",
      )!;
      expect(env("ApiFn").PLATFORM_ADMIN_EMAILS).toEqual({ Ref: logicalId });
    });

    it("stays API-only and never embeds an email in the template", () => {
      expect(env("RedirectFn").PLATFORM_ADMIN_EMAILS).toBeUndefined();
      expect(env("WorkerFn").PLATFORM_ADMIN_EMAILS).toBeUndefined();
      expect(JSON.stringify(template.toJSON())).not.toMatch(/@example\.com/);
    });
  });
});
