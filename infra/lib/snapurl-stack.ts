import {
  CfnOutput,
  Duration,
  RemovalPolicy,
  Stack,
  type StackProps,
} from "aws-cdk-lib";
import * as cloudfront from "aws-cdk-lib/aws-cloudfront";
import * as origins from "aws-cdk-lib/aws-cloudfront-origins";
import * as ec2 from "aws-cdk-lib/aws-ec2";
import * as iam from "aws-cdk-lib/aws-iam";
import * as events from "aws-cdk-lib/aws-events";
import * as targets from "aws-cdk-lib/aws-events-targets";
import * as lambda from "aws-cdk-lib/aws-lambda";
import * as logs from "aws-cdk-lib/aws-logs";
import * as apigw from "aws-cdk-lib/aws-apigatewayv2";
import * as integrations from "aws-cdk-lib/aws-apigatewayv2-integrations";
import * as budgets from "aws-cdk-lib/aws-budgets";
import * as sns from "aws-cdk-lib/aws-sns";
import * as subscriptions from "aws-cdk-lib/aws-sns-subscriptions";
import * as rds from "aws-cdk-lib/aws-rds";
import type { Construct } from "constructs";
import * as path from "node:path";
import { SnapUrlConfig } from "./config.js";

/* ============================================================
   SnapURL on AWS.

   Every structural choice below is driven by one number: the
   account has $100 of credits, valid 12 months, on the free tier
   introduced in July 2025 — which has no 750-hour RDS allowance.

   At this workload Lambda, CloudFront, SQS, SSM and DynamoDB all
   sit inside always-free tiers that never expire. Postgres is
   roughly 92% of the bill. That is why the compute here is
   Lambda rather than Fargate: three Fargate tasks behind an ALB
   would be about $58/month against Lambda's ~$0, and would burn
   the credits in under two months.

   Egress is the one place where cost and correctness pull
   against each other. A managed NAT Gateway costs ~$32/month
   before a byte moves — more than everything else combined,
   including the database — and the standard "put RDS in a
   private subnet" tutorial creates one without mentioning it.
   But the backend genuinely needs the internet: Safe Browsing,
   customer webhooks, Google OAuth (JWKS) and mail all call out.
   The `natStrategy` prop reconciles the two; see the VPC below.
   ============================================================ */

/**
 * How the private subnets reach the internet.
 *
 * - `'instance'` (default): a single t4g.nano NAT *instance* via
 *   `ec2.NatProvider.instanceV2`, ~$3/month. Gives full IPv4 egress so Safe
 *   Browsing, customer webhooks, Google OAuth (JWKS) and mail actually work.
 *   Single point of failure (one instance, one AZ) — acceptable for a hobby
 *   stack, and the reason this is an instance rather than a managed gateway.
 * - `'gateway'`: a managed NAT gateway, ~$32/month. Same topology as
 *   `'instance'` but highly available and zero-maintenance — a one-flag
 *   upgrade when the budget or the traffic justifies it.
 * - `'none'`: the original free, no-egress topology (natGateways: 0, a single
 *   isolated subnet group). Safe Browsing, webhooks, OAuth and mail then stay
 *   non-functional; choosing this is the operator's explicit decision to trade
 *   those features for $0 of egress cost.
 *
 * NAT (instance/gateway) was chosen over an IPv6 egress-only IGW because
 * arbitrary customer webhook endpoints cannot be relied on to publish AAAA
 * records, so IPv6-only egress would leave webhook coverage patchy. See the
 * VPC block below and docs/DECISIONS.md.
 */
export type NatStrategy = "gateway" | "instance" | "none";

export interface SnapUrlStackProps extends StackProps {
  /**
   * SSM Parameter Store prefix holding this stage's configuration,
   * e.g. `/snapurl/prod`. See `infra/lib/config.ts`.
   */
  configPrefix: string;
  /**
   * Where the dashboard is served from. Used for CORS on the API.
   *
   * Optional: normally this comes from Parameter Store so that it is set once
   * rather than retyped on every deploy. Passing it (`-c webOrigin=...`)
   * overrides the stored value for a one-off deploy against a preview URL.
   */
  webOrigin?: string;
  /** Public hostname the redirect service answers on. Same precedence as above. */
  redirectOrigin?: string;
  /**
   * How the backend reaches the internet. Defaults to `'instance'` (a
   * t4g.nano NAT instance, ~$3/month) so Safe Browsing, webhooks, OAuth and
   * mail work out of the box. `'gateway'` is the one-flag ~$32/month managed
   * upgrade; `'none'` preserves the original free, no-egress isolated-only
   * topology at the cost of those features. See {@link NatStrategy}.
   */
  natStrategy?: NatStrategy;
  /**
   * Where AWS Budgets alarms are delivered. Optional: budgets are only useful
   * with a destination, and a subscription to an empty address fails at deploy
   * time, so when this is unset the budget + SNS topic are simply not created
   * (the stack still synths and deploys). Set it per deploy with
   * `-c budgetEmail=you@example.com`. See the Budgets block below.
   */
  budgetEmail?: string;
}

export class SnapUrlStack extends Stack {
  constructor(scope: Construct, id: string, props: SnapUrlStackProps) {
    super(scope, id, props);

    /* ---------------------------------------------------------
       Network
       --------------------------------------------------------- */

    /* How the backend reaches the internet. Default 'instance': a t4g.nano NAT
       instance (~$3/month) rather than a managed NAT gateway (~$32/month),
       because a hobby stack does not need the gateway's per-AZ redundancy.
       'gateway' is the one-flag upgrade to that redundancy; 'none' keeps the
       original zero-egress topology. See NatStrategy above. A value that is
       present but not one of the three fails synth loudly here rather than
       silently defaulting, so a `-c natStrategy=gatway` typo is caught. */
    const natStrategy: NatStrategy = props.natStrategy ?? "instance";
    if (!["gateway", "instance", "none"].includes(natStrategy)) {
      throw new Error(
        `Invalid natStrategy '${natStrategy as string}'. ` +
          `Expected one of: 'gateway', 'instance', 'none' (default 'instance').`,
      );
    }

    /* Three egress strategies, one VPC shape parameterised by natStrategy:

         'none'      natGateways: 0, no NAT device. PUBLIC + a single isolated
                     subnet group. Nothing in a private subnet reaches the
                     internet — the original free topology. Safe Browsing,
                     webhooks, OAuth and mail stay dead; the operator's choice.
         'instance'  natGateways: 1 through a t4g.nano NAT *instance*
                     (NatProvider.instanceV2, ~$3/month). Full IPv4 egress.
                     Single instance in a single AZ — a single point of
                     failure, which is why it is an instance and not a gateway;
                     acceptable for a hobby stack, the default.
         'gateway'   natGateways: 1 through a managed NAT *gateway*
                     (~$32/month). Same topology, highly available, no
                     maintenance — the paid upgrade from 'instance'.

       NAT (either device) over an IPv6 egress-only IGW: arbitrary customer
       webhook endpoints cannot be relied on to publish AAAA records, so
       IPv6-only egress would leave webhook coverage patchy. When NAT is on we
       add a PRIVATE_WITH_EGRESS group ('egress') for the app Lambdas and keep
       a PRIVATE_ISOLATED group ('isolated') for the DB, which never egresses.
       The exhaustive switch below leaves no unhandled strategy, so synth is
       valid by construction for all three values. */
    const egressAz = ec2.InstanceType.of(
      ec2.InstanceClass.BURSTABLE4_GRAVITON,
      ec2.InstanceSize.NANO,
    );
    let vpcProps: ec2.VpcProps;
    switch (natStrategy) {
      case "none":
        vpcProps = {
          maxAzs: 2, // RDS requires a subnet group spanning at least two.
          natGateways: 0,
          subnetConfiguration: [
            { name: "public", subnetType: ec2.SubnetType.PUBLIC, cidrMask: 24 },
            // ISOLATED, not PRIVATE_WITH_EGRESS: the latter implies a NAT.
            { name: "isolated", subnetType: ec2.SubnetType.PRIVATE_ISOLATED, cidrMask: 24 },
          ],
        };
        break;
      case "instance":
        vpcProps = {
          maxAzs: 2,
          natGateways: 1, // One instance, not one per AZ — the hobby-stack SPOF tradeoff.
          natGatewayProvider: ec2.NatProvider.instanceV2({
            instanceType: egressAz,
            /* OUTBOUND_ONLY, not the INBOUND_AND_OUTBOUND default: a NAT
               accepts traffic *from the private subnets* and forwards it out;
               it must not accept unsolicited inbound from the internet. The
               default synthesizes a security group that allows all inbound
               from 0.0.0.0/0 on this public-IP instance (cdk synth W2508),
               which is unnecessary attack surface. OUTBOUND_ONLY keeps
               allowAllOutbound (so egress still forwards) and drops the
               0.0.0.0/0 ingress rule; return traffic for outbound flows is
               permitted by the SG's stateful behaviour, and the private-subnet
               default route still points at this instance's ENI, so egress is
               unaffected. */
            defaultAllowedTraffic: ec2.NatTrafficDirection.OUTBOUND_ONLY,
          }),
          subnetConfiguration: [
            { name: "public", subnetType: ec2.SubnetType.PUBLIC, cidrMask: 24 },
            { name: "egress", subnetType: ec2.SubnetType.PRIVATE_WITH_EGRESS, cidrMask: 24 },
            { name: "isolated", subnetType: ec2.SubnetType.PRIVATE_ISOLATED, cidrMask: 24 },
          ],
        };
        break;
      case "gateway":
        vpcProps = {
          maxAzs: 2,
          natGateways: 1, // One gateway, not one per AZ — cost over redundancy.
          // No natGatewayProvider: the default is a managed NAT gateway.
          subnetConfiguration: [
            { name: "public", subnetType: ec2.SubnetType.PUBLIC, cidrMask: 24 },
            { name: "egress", subnetType: ec2.SubnetType.PRIVATE_WITH_EGRESS, cidrMask: 24 },
            { name: "isolated", subnetType: ec2.SubnetType.PRIVATE_ISOLATED, cidrMask: 24 },
          ],
        };
        break;
      default: {
        // Exhaustiveness guard: if NatStrategy gains a member, this is a
        // compile error rather than a silent no-egress deploy.
        const unreachable: never = natStrategy;
        throw new Error(`Unhandled natStrategy: ${String(unreachable)}`);
      }
    }

    const vpc = new ec2.Vpc(this, "Vpc", vpcProps);

    /* The DB never needs egress, so it stays in the isolated group in every
       mode. The app Lambdas take the egress-aware group: PRIVATE_WITH_EGRESS
       when a NAT device exists, else the isolated group (which is all there is
       when natStrategy === 'none'). */
    const databaseSubnets: ec2.SubnetSelection = {
      subnetType: ec2.SubnetType.PRIVATE_ISOLATED,
    };
    const appLambdaSubnets: ec2.SubnetSelection = {
      subnetType:
        natStrategy === "none"
          ? ec2.SubnetType.PRIVATE_ISOLATED
          : ec2.SubnetType.PRIVATE_WITH_EGRESS,
    };

    /* Gateway endpoints are free. Interface endpoints are ~$7/month each, so
       only S3 and DynamoDB get one — the two that happen to be gateways. */
    vpc.addGatewayEndpoint("S3Endpoint", { service: ec2.GatewayVpcEndpointAwsService.S3 });
    vpc.addGatewayEndpoint("DynamoEndpoint", { service: ec2.GatewayVpcEndpointAwsService.DYNAMODB });

    /* ---------------------------------------------------------
       Database
       --------------------------------------------------------- */

    const dbSecurityGroup = new ec2.SecurityGroup(this, "DbSg", {
      vpc,
      description: "Postgres. Reachable only from the Lambdas in this stack.",
      allowAllOutbound: false,
    });

    const database = new rds.DatabaseInstance(this, "Database", {
      engine: rds.DatabaseInstanceEngine.postgres({
        // Must be 18 or later: the schema uses uuidv7(), which does not exist
        // in 17. docker-compose.yml pins the same major version.
        version: rds.PostgresEngineVersion.VER_18,
      }),
      // Graviton. Same price class as t3.micro and measurably faster.
      instanceType: ec2.InstanceType.of(ec2.InstanceClass.BURSTABLE4_GRAVITON, ec2.InstanceSize.MICRO),
      vpc,
      // Always isolated: the database never needs egress, in any natStrategy.
      vpcSubnets: databaseSubnets,
      securityGroups: [dbSecurityGroup],
      multiAz: false, // Doubles the cost. A hobby project does not need it.
      allocatedStorage: 20,
      maxAllocatedStorage: 50, // Autoscale rather than run out at 3am.
      storageType: rds.StorageType.GP3,
      // Generated, rotated into Secrets Manager, never in an env var or this file.
      credentials: rds.Credentials.fromGeneratedSecret("snapurl"),
      databaseName: "snapurl",
      backupRetention: Duration.days(7),
      deleteAutomatedBackups: false,
      // SNAPSHOT rather than DESTROY: `cdk destroy` on a database should not
      // be the last thing that ever happens to the data.
      removalPolicy: RemovalPolicy.SNAPSHOT,
      deletionProtection: true,
      enablePerformanceInsights: false, // Not free on t4g.micro.
      publiclyAccessible: false,
      /* Encryption at rest costs nothing on RDS and `cdk synth` reports its
         absence as a validation violation. It can only be set when the
         instance is created, so the cheap moment to get it right is before the
         first deploy — which has not happened yet. */
      storageEncrypted: true,
    });

    const lambdaSecurityGroup = new ec2.SecurityGroup(this, "LambdaSg", {
      vpc,
      description: "SnapURL Lambdas.",
      /* Outbound-open so the Lambdas can egress on 443 through the NAT device.
         This path only actually reaches the internet when natStrategy !==
         'none' (the app Lambdas then sit in PRIVATE_WITH_EGRESS); under 'none'
         the same rule is harmless because there is no route out. */
      allowAllOutbound: true,
    });
    dbSecurityGroup.addIngressRule(
      lambdaSecurityGroup,
      ec2.Port.tcp(5432),
      "Postgres from the SnapURL Lambdas only",
    );

    /* The database password ends up in the Lambda environment.
     *
     * The alternative is reading it from Secrets Manager at cold start. Under
     * the old zero-egress topology that required an interface VPC endpoint
     * (~$7/month) because the functions sat in isolated subnets with no NAT.
     * With natStrategy defaulting to a NAT instance the app Lambdas now sit in
     * PRIVATE_WITH_EGRESS subnets (see the VPC block above), so a runtime
     * Secrets Manager lookup is reachable over the NAT without a dedicated
     * endpoint — that path is now viable future work (issue #292), not
     * implemented here.
     *
     * Either way, deploy-time resolution hides nothing from whoever can read a
     * Lambda's configuration: the account owner. At this scale that is not a
     * trade worth making; it becomes one the moment anyone else has console
     * access to this account. Under natStrategy 'none' the old interface-
     * endpoint constraint still applies. Behaviour is unchanged here. */
    const databaseUrl = `postgres://snapurl:${database.secret!.secretValueFromJson("password").unsafeUnwrap()}` +
      `@${database.instanceEndpoint.hostname}:${database.instanceEndpoint.port}/snapurl`;

    /* ---------------------------------------------------------
       Configuration
       --------------------------------------------------------- */

    const config = new SnapUrlConfig(this, "Config", { prefix: props.configPrefix });

    /* Nothing below is a literal. Ordinary settings come from Parameter Store
       and the two signing keys are generated into Secrets Manager, so this
       file contains no configuration to keep in step with anything and no
       secret to leak. `config.ts` explains why both are resolved at deploy
       time rather than read at cold start. */
    const commonEnv: Record<string, string> = {
      NODE_ENV: "production",
      // A Lambda instance serves one request at a time, so a pool larger than
      // one just multiplies idle connections against RDS's small max — which
      // on a db.t4g.micro is small enough to exhaust under modest concurrency.
      DATABASE_POOL_MAX: "1",
      DATABASE_SSL: "true",
      DATABASE_URL: databaseUrl,
      // Context wins over Parameter Store, so a one-off deploy against a
      // preview origin does not mean editing the stored value and remembering
      // to put it back.
      WEB_ORIGIN: props.webOrigin ?? config.get("web-origin"),
      REDIRECT_ORIGIN: props.redirectOrigin ?? config.get("redirect-origin"),
      DEFAULT_DOMAIN: config.get("default-domain"),
      LOG_LEVEL: config.get("log-level"),
      MAIL_FROM: config.get("mail-from"),
      MAIL_TRANSPORT: config.get("mail-transport"),
      THROTTLE_LIMIT: config.get("throttle-limit"),
      THROTTLE_TTL_SECONDS: config.get("throttle-ttl-seconds"),
      /* Absent until this change, and the API would not have started without
         them: apps/api/src/config/env.ts requires both, at 32 characters
         minimum, and throws on boot when either is missing. The redirect
         service needs the access key too — it verifies the short-lived unlock
         token that password-protected links are opened with, and without it
         every such link silently bounces back to the password page. */
      JWT_ACCESS_SECRET: config.jwtAccessSecret.secretValue.unsafeUnwrap(),
      JWT_REFRESH_SECRET: config.jwtRefreshSecret.secretValue.unsafeUnwrap(),
    };

    /* The path each service answers a health probe on. Kept next to the value
       that decides it: the API mounts everything under a prefix, so hardcoding
       "/api/v1/health" somewhere else would break the moment the prefix moved. */
    const API_PREFIX = "api/v1";

    /* Not `as const`: DockerImageFunctionProps wants a mutable
       ISecurityGroup[], and a readonly tuple will not satisfy it. */
    const vpcSettings = {
      vpc,
      /* Egress-aware: PRIVATE_WITH_EGRESS when NAT is on so the API, redirect
         and worker can call Safe Browsing / webhooks / OAuth / mail; the
         isolated group under natStrategy === 'none'. Redirect shares this
         object for RDS access — giving it egress when NAT is on is harmless
         and consistent, and Phase 7 may rely on it. */
      vpcSubnets: appLambdaSubnets,
      securityGroups: [lambdaSecurityGroup] as ec2.ISecurityGroup[],
    };

    const repoRoot = path.resolve(__dirname, "..", "..");

    /* Log retention. CDK's default for a Lambda's auto-created log group is
       "never expire", and Fastify writes two JSON lines per request at `info`
       — at 100M redirects/month that is ~60GB/month ingested with storage
       compounding forever. So each function gets an explicit LogGroup with a
       two-week retention, wired through the function's `logGroup` prop.

       `logGroup` is deliberately used over the older `logRetention` prop: the
       latter provisions a custom-resource Lambda (a LogRetention singleton)
       that calls PutRetentionPolicy on every deploy, whereas an explicit
       LogGroup sets RetentionInDays natively on the CloudFormation resource
       with no extra Lambda. When `logGroup` is supplied, CDK sends the
       function's logs there instead of creating the default group, so the two
       do not collide.

       removalPolicy DESTROY (not the LogGroup default of RETAIN): a hobby
       stack should not leave orphaned log groups behind on `cdk destroy`. The
       logs here are operational, not records to preserve; the database keeps
       its SNAPSHOT policy for the data that matters. */
    const logGroupFor = (id: string) =>
      new logs.LogGroup(this, id, {
        retention: logs.RetentionDays.TWO_WEEKS,
        removalPolicy: RemovalPolicy.DESTROY,
      });

    /* Reserved concurrency caps. Every function shares one db.t4g.micro, which
       allows ~112 connections; 3 are reserved for the superuser and 1 is
       needed by the migrate task, leaving ~108 usable. Each Lambda instance
       holds one connection (DATABASE_POOL_MAX=1 above), so the sum of the caps
       below is the peak connection count: 80 + 20 + 2 = 102, under the ceiling
       with headroom. Uncapped, the 10-second redirect timeout turns a traffic
       spike into exhausted connections plus a bill; the caps make excess
       invocations fail fast instead. Do NOT raise one of these without
       re-checking that the three still sum to under ~108. (The original audit
       proposed 100/20/2 = 122, which exceeds the very ceiling it meant to
       respect; these are the corrected values.) */
    const REDIRECT_RESERVED_CONCURRENCY = 80;
    const API_RESERVED_CONCURRENCY = 20;
    const WORKER_RESERVED_CONCURRENCY = 2;

    /* Container images rather than zip bundles.
       The Dockerfile that builds these is the same one verified locally with
       `docker compose --profile full`, so what runs in Lambda is what was
       tested — not a separately-bundled approximation of it. */
    const imageFor = (app: string, target: "lambda-web" | "lambda-job") =>
      lambda.DockerImageCode.fromImageAsset(repoRoot, {
        file: "Dockerfile",
        buildArgs: { APP: app },
        target,
        // Staging writes into `infra/cdk.out`, which is inside `repoRoot` —
        // the directory being staged. Left alone, each asset copies the
        // previous one's output into itself until `cdk synth` dies with
        // ENAMETOOLONG.
        //
        // `.dockerignore` excludes it, and has to for `docker build` anyway,
        // but that alone is not enough. CDK puts the file's own patterns
        // first and the last match wins, so the `.env.example` re-include
        // near the end of that file pulls those files back out of an already
        // excluded directory. Repeating the exclusion here places it after
        // that negation, which is the ordering that actually holds.
        exclude: ["cdk.out", "**/cdk.out/**"],
      });


    /* ---------------------------------------------------------
       API
       --------------------------------------------------------- */

    const apiFn = new lambda.DockerImageFunction(this, "ApiFn", {
      code: imageFor("api", "lambda-web"),
      memorySize: 1024, // CPU scales with memory; 1024 is the usual sweet spot.
      timeout: Duration.seconds(30),
      reservedConcurrentExecutions: API_RESERVED_CONCURRENCY,
      logGroup: logGroupFor("ApiLogGroup"),
      environment: {
        ...commonEnv,
        API_PREFIX,
        /* The web adapter will not forward a request until this path answers.
           Its default is "/", which the API does not serve — every route is
           under the prefix — so without this the adapter waits out its
           readiness timeout on every cold start before serving anything. */
        AWS_LWA_READINESS_CHECK_PATH: `/${API_PREFIX}/health`,
      },
      ...vpcSettings,
    });


    const httpApi = new apigw.HttpApi(this, "HttpApi", {
      // The app sets its own CORS headers; doing it here too would send two.
      defaultIntegration: new integrations.HttpLambdaIntegration("ApiIntegration", apiFn),
    });

    /* ---------------------------------------------------------
       Redirect — the hot path
       --------------------------------------------------------- */

    const redirectFn = new lambda.DockerImageFunction(this, "RedirectFn", {
      code: imageFor("redirect", "lambda-web"),
      // Smaller than the API on purpose: this function does one key lookup and
      // a 302. Paying for memory it never uses is paying for nothing.
      memorySize: 512,
      timeout: Duration.seconds(10),
      reservedConcurrentExecutions: REDIRECT_RESERVED_CONCURRENCY,
      logGroup: logGroupFor("RedirectLogGroup"),
      /* "/" is a real route here — it serves a domain's root redirect, and
         answering it costs a database round trip. /health is the cheap one and
         the one that actually reports whether Postgres is reachable.

         LOG_LEVEL is pinned to `warn` here, overriding commonEnv's configured
         level (the override wins because it comes later in the spread). This
         is the highest-volume function — two JSON lines per request at `info`
         is ~60GB/month of ingest at 100M redirects — so the hot path stays
         quiet while api and worker keep the configured level. */
      environment: { ...commonEnv, AWS_LWA_READINESS_CHECK_PATH: "/health", LOG_LEVEL: "warn" },
      ...vpcSettings,
    });


    /* IAM auth, not NONE: a NONE Function URL is reachable by anyone on the
       public internet, which skips CloudFront entirely and with it the WAF,
       edge rate limiting, the viewer-country header, and the edge cache — and
       opens a second uncapped path into the redirect Lambda. With AWS_IAM the
       URL only answers to a SigV4-signed request; CloudFront signs via the
       Origin Access Control wired below, and any direct caller gets 403. */
    const redirectUrl = redirectFn.addFunctionUrl({
      authType: lambda.FunctionUrlAuthType.AWS_IAM,
    });

    /* The origin is a Lambda Function URL, and a Function URL rejects any
       request whose Host is not its own hostname — so CloudFront must forward
       the origin's Host, never the viewer's (that is what the managed
       ALL_VIEWER_EXCEPT_HOST_HEADER policy did). But the redirect app resolves
       a link by the viewer's domain, so it still needs to see it somewhere.
       This viewer-request function copies the viewer Host into
       x-forwarded-host, which the origin request policy below forwards while
       leaving Host alone. apps/redirect/src/main.ts reads exactly that header.

       It is a named, standalone function on purpose: Phase 7 (#289) extends
       this same function with the KeyValueStore edge fast path. */
    const redirectViewerRequest = new cloudfront.Function(this, "RedirectViewerRequest", {
      runtime: cloudfront.FunctionRuntime.JS_2_0,
      comment: "Copies the viewer Host into x-forwarded-host for the redirect origin.",
      code: cloudfront.FunctionCode.fromInline(
        [
          "function handler(event) {",
          "  var request = event.request;",
          "  request.headers['x-forwarded-host'] = { value: request.headers.host.value };",
          "  return request;",
          "}",
        ].join("\n"),
      ),
    });

    /* Host is deliberately NOT in this allow-list: CloudFront always sends the
       origin's own Host (required by the Function URL origin above), and the
       app reads the viewer's host from x-forwarded-host that the function set.
       queryStringBehavior.all() is required because the unlock token (`k`) and
       the UTM / forwardQuery overrides both ride the query string — dropping it
       would silently break password-protected links and campaign tracking.
       CloudFront-Viewer-Country and CloudFront-Viewer-City are CloudFront-
       generated headers: CloudFront adds them to the origin request precisely
       because they are allow-listed here, which is what powers country routing
       and click_events.country/city. */
    const redirectOriginRequestPolicy = new cloudfront.OriginRequestPolicy(this, "RedirectOrigReqPolicy", {
      comment: "Forwards viewer headers plus CloudFront geo headers to the redirect origin; excludes Host.",
      headerBehavior: cloudfront.OriginRequestHeaderBehavior.allowList(
        "user-agent",
        "referer",
        "accept-language",
        "x-forwarded-host",
        "CloudFront-Viewer-Country",
        "CloudFront-Viewer-City",
      ),
      cookieBehavior: cloudfront.OriginRequestCookieBehavior.none(),
      queryStringBehavior: cloudfront.OriginRequestQueryStringBehavior.all(),
    });

    const distribution = new cloudfront.Distribution(this, "RedirectCdn", {
      defaultBehavior: {
        /* Origin Access Control, not a plain FunctionUrlOrigin: this helper
           creates the OAC, sets signing to SIGV4_ALWAYS, and grants CloudFront
           permission to invoke the AWS_IAM Function URL — so only CloudFront
           can reach the origin and direct callers get 403. SigV4 validation
           requires the signed Host to match the origin's own hostname, so
           CloudFront must send the origin Host rather than the viewer's. That
           is exactly what the RedirectOrigReqPolicy below does (Host is not in
           its allow-list), and the RedirectViewerRequest function (#274) copies
           the viewer Host into x-forwarded-host for the app to read. That
           x-forwarded-host function is therefore a prerequisite for this OAC,
           not a nicety — without it the app could not resolve the viewer's
           domain once Host is pinned to the origin. */
        origin: origins.FunctionUrlOrigin.withOriginAccessControl(redirectUrl),
        // Redirects must never be cached at the edge. The product promise is
        // "print it once, change where it points forever" — a cached 302 makes
        // a destination edit invisible to anyone who already clicked.
        cachePolicy: cloudfront.CachePolicy.CACHING_DISABLED,
        originRequestPolicy: redirectOriginRequestPolicy,
        functionAssociations: [
          { function: redirectViewerRequest, eventType: cloudfront.FunctionEventType.VIEWER_REQUEST },
        ],
        viewerProtocolPolicy: cloudfront.ViewerProtocolPolicy.REDIRECT_TO_HTTPS,
        allowedMethods: cloudfront.AllowedMethods.ALLOW_GET_HEAD_OPTIONS,
      },
      // Country routing and click_events.country/city work without storing an
      // IP address: the custom origin request policy above forwards CloudFront's
      // CloudFront-Viewer-Country / -City headers, and the viewer-request
      // function supplies x-forwarded-host so the app can resolve the link's
      // domain.
      //
      // PriceClass 200, not 100: India is in Price Class 200, and 100 (US /
      // Canada / Mexico / Europe / Israel) excludes it. Under 100 an Indian
      // visitor — the primary audience — routes to a European edge and back to
      // ap-south-1 for every request, and since the behaviour is
      // CACHING_DISABLED nothing is absorbed at the edge, so every request pays
      // both legs (~150-210 ms of p50). 200 adds the Indian (and wider APAC/
      // South-American) edges; the marginally higher per-GB egress there is
      // immaterial at the payload size of a 302. (300 — the whole world,
      // incl. Australia/NZ — buys nothing this audience uses.)
      priceClass: cloudfront.PriceClass.PRICE_CLASS_200,
      comment: "SnapURL redirect edge",
    });

    /* ---------------------------------------------------------
       Worker
       --------------------------------------------------------- */

    const workerFn = new lambda.DockerImageFunction(this, "WorkerFn", {
      code: imageFor("worker", "lambda-job"),
      memorySize: 1024,
      // Rollups over a day of clicks; generous because it runs once a minute,
      // not once a request.
      timeout: Duration.minutes(5),
      reservedConcurrentExecutions: WORKER_RESERVED_CONCURRENCY,
      logGroup: logGroupFor("WorkerLogGroup"),
      /* No WORKER_MODE: nothing reads it. The long-running process takes
         `--once` from argv, and the Lambda entrypoint (apps/worker/src/lambda.ts)
         skips that path entirely and calls the two jobs directly. */
      environment: commonEnv,
      ...vpcSettings,
    });


    /* EventBridge rather than an in-process interval: a scheduled rule
       survives a redeploy and a scale-to-zero, which the v1 node-cron did
       not — it died with the process that started it. */
    new events.Rule(this, "WorkerSchedule", {
      schedule: events.Schedule.rate(Duration.minutes(1)),
      targets: [new targets.LambdaFunction(workerFn, { retryAttempts: 2 })],
      description: "Drains the click queue and refreshes the rollup tables.",
    });

    /* ---------------------------------------------------------
       Budget alarms

       The account runs on $100 of credits, and credits mask overspend until
       they are gone — by which point the design premise (the credits last the
       year) may already be false. A budget with early alarms turns that from a
       surprise into a warning.

       One monthly COST budget with three ACTUAL notifications at absolute
       dollar thresholds ($25 / $50 / $75), rather than three separate budgets:
       a single budget keeps the thresholds together and each fires when actual
       spend crosses that dollar figure. thresholdType is ABSOLUTE_VALUE (a
       dollar amount) rather than PERCENTAGE, so the alarm points are exactly
       $25/$50/$75 regardless of the budget's own limit. The limit is set to
       $100 to mirror the credit balance; the notifications, not the limit, are
       what actually alert.

       AWS Budgets is a global service (it lives in the account, not a region),
       so this CfnBudget synthesises and deploys fine from the stack's
       ap-south-1 region — it does not need to be pinned to us-east-1.

       Notifications go to an SNS topic with an email subscription (rather than
       a bare EMAIL subscriber on the budget) so more subscribers — a second
       address, a chatops webhook — can be added later without touching the
       budget. Guarded on props.budgetEmail: with no destination a budget is
       useless and a subscription to an empty address fails at deploy, so when
       the email is unset the topic and budget are simply not created and the
       stack still deploys. Set it with `-c budgetEmail=you@example.com`. */
    if (props.budgetEmail) {
      const budgetTopic = new sns.Topic(this, "BudgetAlarmTopic", {
        displayName: "SnapURL budget alarms",
      });
      budgetTopic.addSubscription(new subscriptions.EmailSubscription(props.budgetEmail));

      /* AWS Budgets publishes to the topic, so the topic policy must allow the
         budgets service principal to Publish. */
      budgetTopic.grantPublish(new iam.ServicePrincipal("budgets.amazonaws.com"));

      const budgetSubscribers: budgets.CfnBudget.SubscriberProperty[] = [
        { subscriptionType: "SNS", address: budgetTopic.topicArn },
      ];
      const notificationAt = (
        threshold: number,
      ): budgets.CfnBudget.NotificationWithSubscribersProperty => ({
        notification: {
          notificationType: "ACTUAL",
          comparisonOperator: "GREATER_THAN",
          threshold,
          thresholdType: "ABSOLUTE_VALUE",
        },
        subscribers: budgetSubscribers,
      });

      new budgets.CfnBudget(this, "MonthlyCostBudget", {
        budget: {
          budgetName: "SnapURL-monthly-cost",
          budgetType: "COST",
          timeUnit: "MONTHLY",
          // Mirrors the $100 credit balance. The notifications below, not this
          // limit, are what alert; absolute-value thresholds fire at the dollar
          // figures regardless of it.
          budgetLimit: { amount: 100, unit: "USD" },
        },
        notificationsWithSubscribers: [
          notificationAt(25),
          notificationAt(50),
          notificationAt(75),
        ],
      });
    }

    /* ---------------------------------------------------------
       Outputs
       --------------------------------------------------------- */

    new CfnOutput(this, "ApiUrl", {
      value: httpApi.apiEndpoint,
      description: "Set this as NEXT_PUBLIC_API_URL on Vercel, with /api/v1 appended.",
    });
    new CfnOutput(this, "RedirectDomain", {
      value: `https://${distribution.distributionDomainName}`,
      description: "CNAME your short domain here.",
    });
    /* The raw redirect Function URL. It is IAM-signed behind OAC, so a direct
       (unsigned) request must return 403 while the same path through
       RedirectDomain succeeds — that is the guarantee #276 is about. Exposed
       here so the Phase 7 (#289) deployed smoke gate can assert the direct 403;
       see scripts/smoke-redirect.sh. */
    new CfnOutput(this, "RedirectFunctionUrl", {
      value: redirectUrl.url,
      description: "IAM-signed origin behind CloudFront OAC; a direct request must return 403.",
    });
    new CfnOutput(this, "DatabaseSecretArn", {
      value: database.secret?.secretArn ?? "(none)",
      description: "Postgres credentials. Generated by CloudFormation; never in this repo.",
    });
    /* Needed to apply migrations. A fresh deploy creates the database but no
       tables, and RDS is unreachable from outside the VPC, so the only way to
       migrate is to invoke this function with {"task":"migrate"}. Printing the
       name here saves looking it up in the console. */
    new CfnOutput(this, "WorkerFunctionName", {
      value: workerFn.functionName,
      description: 'Invoke with {"task":"migrate"} to apply database migrations.',
    });

    new CfnOutput(this, "ConfigPrefix", {
      value: props.configPrefix,
      description: "Parameter Store prefix this stage reads. Change a value there, then redeploy.",
    });
    new CfnOutput(this, "JwtSecretArns", {
      value: `${config.jwtAccessSecret.secretArn} ${config.jwtRefreshSecret.secretArn}`,
      description: "JWT signing keys. Rotating either invalidates the tokens it signed.",
    });
  }
}
