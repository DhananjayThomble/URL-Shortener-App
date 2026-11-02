import { App } from "aws-cdk-lib";
import { Template } from "aws-cdk-lib/assertions";
import { beforeAll, describe, expect, it } from "vitest";
import { SnapUrlStack } from "./snapurl-stack.js";

/**
 * #996 — the alarms' two degradation paths, both of which the stack must still
 * synthesise cleanly:
 *
 *   • No domainName  → no uptime canary (there is no stable public URL to
 *     probe), but every metric alarm the stack can attach to an existing
 *     resource is STILL created. Fourteen alarms, no canary.
 *   • No budgetEmail → no SNS topic, so the alarms are created with NO action.
 *     They still exist and still flip to ALARM; there is just nobody subscribed
 *     to be told, exactly how the budget block already degrades.
 *
 * Asset staging stays disabled here (the repo default, vitest.setup.ts): with
 * no canary there is no Synthetics asset to validate, so the fast path is safe
 * and this file synthesises in seconds.
 */

describe("SnapUrlStack — alarms degrade cleanly without a domain or a budget email (#996)", () => {
  let template: Template;

  beforeAll(() => {
    template = Template.fromStack(
      new SnapUrlStack(new App(), "TestStack", {
        env: { account: "111111111111", region: "us-east-1" },
        configPrefix: "/test/snapurl",
        natStrategy: "instance",
        natAmiIds: { "us-east-1": "ami-0123456789abcdef0" },
        // No budgetEmail, no domainName.
      }),
    );
  }, 120_000);

  it("still creates the fourteen non-canary alarms with no domain", () => {
    expect(Object.keys(template.findResources("AWS::CloudWatch::Alarm"))).toHaveLength(14);
  });

  it("creates no Synthetics canary without a domain", () => {
    template.resourceCountIs("AWS::Synthetics::Canary", 0);
  });

  it("creates no SNS topic and leaves the alarms without an action when budgetEmail is unset", () => {
    template.resourceCountIs("AWS::SNS::Topic", 0);
    const alarms = Object.values(template.findResources("AWS::CloudWatch::Alarm"));
    for (const a of alarms) {
      // No AlarmActions key at all (or an empty one) — never a dangling Ref to a
      // topic that does not exist.
      const actions = (a.Properties as { AlarmActions?: unknown[] }).AlarmActions;
      expect(actions === undefined || (Array.isArray(actions) && actions.length === 0)).toBe(true);
    }
  });

  it("still carries the backlog-metrics namespace on the worker", () => {
    const fns = template.findResources("AWS::Lambda::Function");
    const worker = Object.entries(fns).find(([id]) => id.startsWith("WorkerFn"))![1];
    const env = (worker.Properties as { Environment: { Variables: Record<string, unknown> } }).Environment.Variables;
    expect(env.BACKLOG_METRICS_NAMESPACE).toBe("SnapURL/Backlog");
  });
});
