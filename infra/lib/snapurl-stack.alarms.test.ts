import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { App } from "aws-cdk-lib";
import { Match, Template } from "aws-cdk-lib/assertions";
import * as acm from "aws-cdk-lib/aws-certificatemanager";
import { beforeAll, describe, expect, it } from "vitest";
import { SnapUrlStack } from "./snapurl-stack.js";

/**
 * #996 — uptime check and CloudWatch alarms.
 *
 * The acceptance asks for an infra test that asserts each alarm exists with its
 * threshold. This file synthesises the stack ONCE (see snapurl-stack.nat.test.ts
 * on why one synth per file) with budgetEmail set — so the alarm SNS actions
 * exist — and with a domain, so the Synthetics canary and its alarm are present
 * too. It then checks every alarm by its metric name + threshold, the canary's
 * schedule and runtime, and the additions-only guarantees that matter most:
 * the alarms reuse the EXISTING budget topic (no second SNS topic is created)
 * and the worker carries the backlog-metrics namespace the two backlog alarms
 * read.
 */

describe("SnapUrlStack — uptime canary and CloudWatch alarms (#996)", () => {
  let template: Template;

  beforeAll(() => {
    /* This file's stack synthesises the Synthetics canary. Two forces fight
       here and this setup satisfies both:

       1. The repo keeps asset staging DISABLED in tests (#921, vitest.setup.ts)
          so the three monorepo Docker-image assets are not fingerprinted — that
          walk is ~3 minutes now and blows any hook timeout. We keep it disabled,
          so the synth runs in the fast ~15-20s path like every sibling.
       2. But the Synthetics `Code.fromAsset` validation (aws-synthetics
          code.js) computes `path.join(Stage.of(scope).outdir, asset.assetPath)`
          and lstats it. With staging DISABLED `asset.assetPath` is the ABSOLUTE
          canary source dir, so the join is `<outdir>/<abs path>` and the canary
          construction throws ENOENT unless that path happens to exist.

       We give the App a writable temp outdir and, inside it, recreate the
       canary dir at the joined path as a symlink to the real one — so the single
       lstat the validator does resolves to the real (existing) directory. This
       touches only that one validation; no asset is written (staging is off) and
       no assertion reads an asset hash. The temp dir is cleaned up after. */
    const outdir = fs.mkdtempSync(path.join(os.tmpdir(), "snapurl-alarms-"));
    const canaryDir = path.join(__dirname, "..", "functions", "canary");
    // The validator lstats path.join(outdir, <abs canaryDir>) === outdir + canaryDir.
    const joined = path.join(outdir, canaryDir);
    fs.mkdirSync(path.dirname(joined), { recursive: true });
    // A real directory copy, not a symlink: the validator does
    // lstatSync(joined).isDirectory(), and lstat on a symlink is not a directory.
    fs.cpSync(canaryDir, joined, { recursive: true });
    const app = new App({ outdir });
    template = Template.fromStack(
      new SnapUrlStack(app, "TestStack", {
        env: { account: "111111111111", region: "us-east-1" },
        configPrefix: "/test/snapurl",
        natStrategy: "instance",
        natAmiIds: { "us-east-1": "ami-0123456789abcdef0" },
        budgetEmail: "ops@example.com",
        domainName: "snapurl.in",
        // The stack only requires domainName and certificate to be set together;
        // a by-ARN reference is enough to synthesise without a cross-region cert
        // stack. us-east-1 here keeps CloudFront's own region requirement happy.
        certificate: acm.Certificate.fromCertificateArn(
          app,
          "TestCert",
          "arn:aws:acm:us-east-1:111111111111:certificate/00000000-0000-0000-0000-000000000000",
        ),
      }),
    );
    fs.rmSync(outdir, { recursive: true, force: true });
  }, 120_000);

  /** Assert exactly one alarm exists whose metric matches (namespace,
   *  metricName) and whose Threshold equals `threshold`. Matching on the metric
   *  rather than the logical id keeps the test meaningful if an id is ever
   *  refactored. */
  const expectAlarm = (
    opts: { namespace: string; metricName: string; threshold: number; dimensions?: boolean; comparison?: string },
  ): void => {
    const alarms = template.findResources("AWS::CloudWatch::Alarm");
    const hits = Object.values(alarms).filter((a) => {
      const p = a.Properties as {
        Namespace?: string;
        MetricName?: string;
        Threshold?: number;
        ComparisonOperator?: string;
      };
      return p.Namespace === opts.namespace && p.MetricName === opts.metricName && p.Threshold === opts.threshold;
    });
    expect(
      hits.length,
      `expected one alarm on ${opts.namespace}/${opts.metricName} @ ${opts.threshold}, found ${hits.length}`,
    ).toBe(1);
    if (opts.comparison) {
      expect((hits[0]!.Properties as { ComparisonOperator: string }).ComparisonOperator).toBe(opts.comparison);
    }
    // Every alarm this issue adds treats missing data as not-breaching so an
    // idle healthy system never pages.
    expect((hits[0]!.Properties as { TreatMissingData: string }).TreatMissingData).toBe("notBreaching");
  };

  it("adds exactly fifteen alarms", () => {
    // 6 Lambda (errors+throttles x api/redirect/worker) + API 5xx + redirect p99
    // + 2 backlog + 2 SES + 2 RDS + 1 canary = 15.
    expect(Object.keys(template.findResources("AWS::CloudWatch::Alarm"))).toHaveLength(15);
  });

  it("alarms on Lambda errors for each function (threshold 1)", () => {
    const errorAlarms = Object.values(template.findResources("AWS::CloudWatch::Alarm")).filter(
      (a) => (a.Properties as { Namespace?: string; MetricName?: string }).Namespace === "AWS/Lambda" &&
        (a.Properties as { MetricName?: string }).MetricName === "Errors",
    );
    expect(errorAlarms).toHaveLength(3);
    for (const a of errorAlarms) expect((a.Properties as { Threshold: number }).Threshold).toBe(1);
  });

  it("alarms on Lambda throttles for each function (threshold 1)", () => {
    const throttleAlarms = Object.values(template.findResources("AWS::CloudWatch::Alarm")).filter(
      (a) => (a.Properties as { Namespace?: string; MetricName?: string }).Namespace === "AWS/Lambda" &&
        (a.Properties as { MetricName?: string }).MetricName === "Throttles",
    );
    expect(throttleAlarms).toHaveLength(3);
    for (const a of throttleAlarms) expect((a.Properties as { Threshold: number }).Threshold).toBe(1);
  });

  it("alarms on API 5xx rate (threshold 5)", () => {
    expectAlarm({ namespace: "AWS/ApiGatewayV2", metricName: "5xx", threshold: 5 });
  });

  it("alarms on redirect p99 latency over 1s", () => {
    const p99 = Object.values(template.findResources("AWS::CloudWatch::Alarm")).find(
      (a) =>
        (a.Properties as { Namespace?: string; MetricName?: string }).Namespace === "AWS/Lambda" &&
        (a.Properties as { MetricName?: string }).MetricName === "Duration" &&
        (a.Properties as { ExtendedStatistic?: string }).ExtendedStatistic === "p99",
    );
    expect(p99, "expected a p99 Duration alarm").toBeDefined();
    expect((p99!.Properties as { Threshold: number }).Threshold).toBe(1000);
  });

  it("alarms on the projection-outbox backlog (stuck rows >= 1)", () => {
    expectAlarm({ namespace: "SnapURL/Backlog", metricName: "OutboxStuck", threshold: 1 });
  });

  it("alarms on the webhook backlog (failed deliveries > 20)", () => {
    expectAlarm({ namespace: "SnapURL/Backlog", metricName: "WebhookFailed", threshold: 20 });
  });

  it("alarms on SES bounce and complaint rates", () => {
    expectAlarm({ namespace: "AWS/SES", metricName: "Reputation.BounceRate", threshold: 0.05 });
    expectAlarm({ namespace: "AWS/SES", metricName: "Reputation.ComplaintRate", threshold: 0.001 });
  });

  it("alarms on RDS CPU (> 80%) and connections (> 80)", () => {
    expectAlarm({ namespace: "AWS/RDS", metricName: "CPUUtilization", threshold: 80 });
    expectAlarm({ namespace: "AWS/RDS", metricName: "DatabaseConnections", threshold: 80 });
  });

  it("alarms when the uptime canary success drops below 100%", () => {
    expectAlarm({
      namespace: "CloudWatchSynthetics",
      metricName: "SuccessPercent",
      threshold: 100,
      comparison: "LessThanThreshold",
    });
  });

  it("creates a 5-minute Synthetics canary on the puppeteer runtime", () => {
    template.resourceCountIs("AWS::Synthetics::Canary", 1);
    template.hasResourceProperties("AWS::Synthetics::Canary", {
      Schedule: Match.objectLike({ Expression: "rate(5 minutes)" }),
      RuntimeVersion: "syn-nodejs-puppeteer-9.1",
    });
  });

  it("reuses the existing budget SNS topic rather than creating a second one", () => {
    // The budget block + this issue share ONE topic; no new topic is added.
    template.resourceCountIs("AWS::SNS::Topic", 1);
    // Every alarm's action points at that one topic.
    const topicId = Object.keys(template.findResources("AWS::SNS::Topic"))[0]!;
    const alarms = Object.values(template.findResources("AWS::CloudWatch::Alarm"));
    for (const a of alarms) {
      const actions = (a.Properties as { AlarmActions?: Array<{ Ref?: string }> }).AlarmActions ?? [];
      expect(actions.some((ref) => ref.Ref === topicId)).toBe(true);
    }
  });

  it("sets the backlog-metrics namespace on the worker so the backlog alarms have data", () => {
    const fns = template.findResources("AWS::Lambda::Function");
    const worker = Object.entries(fns).find(([id]) => id.startsWith("WorkerFn"))![1];
    const env = (worker.Properties as { Environment: { Variables: Record<string, unknown> } }).Environment.Variables;
    expect(env.BACKLOG_METRICS_NAMESPACE).toBe("SnapURL/Backlog");
  });
});
