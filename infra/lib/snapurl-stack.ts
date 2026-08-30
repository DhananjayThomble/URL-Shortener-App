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
import * as events from "aws-cdk-lib/aws-events";
import * as targets from "aws-cdk-lib/aws-events-targets";
import * as lambda from "aws-cdk-lib/aws-lambda";
import * as apigw from "aws-cdk-lib/aws-apigatewayv2";
import * as integrations from "aws-cdk-lib/aws-apigatewayv2-integrations";
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
          natGatewayProvider: ec2.NatProvider.instanceV2({ instanceType: egressAz }),
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
     * The alternative is reading it from Secrets Manager at cold start, which
     * needs an interface VPC endpoint because these functions sit in isolated
     * subnets with no NAT. That endpoint costs ~$7/month -- around 45% of the
     * database itself -- to hide a password from the only person who can read
     * a Lambda's configuration in the first place: the account owner.
     *
     * At this scale that is not a trade worth making. It becomes one the
     * moment anyone else has console access to this account, and the fix is
     * one endpoint plus a runtime lookup. */
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
      /* "/" is a real route here — it serves a domain's root redirect, and
         answering it costs a database round trip. /health is the cheap one and
         the one that actually reports whether Postgres is reachable. */
      environment: { ...commonEnv, AWS_LWA_READINESS_CHECK_PATH: "/health" },
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
      // domain. PriceClass 100 keeps egress cheapest.
      priceClass: cloudfront.PriceClass.PRICE_CLASS_100,
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
