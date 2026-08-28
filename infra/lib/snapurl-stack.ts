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

   The single most expensive mistake available in this file is a
   NAT Gateway. It costs ~$32/month before a byte moves — more
   than everything else combined, including the database — and
   the standard "put RDS in a private subnet" tutorial creates
   one without mentioning it. See the VPC below.
   ============================================================ */

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
}

export class SnapUrlStack extends Stack {
  constructor(scope: Construct, id: string, props: SnapUrlStackProps) {
    super(scope, id, props);

    /* ---------------------------------------------------------
       Network
       --------------------------------------------------------- */

    const vpc = new ec2.Vpc(this, "Vpc", {
      maxAzs: 2, // RDS requires a subnet group spanning at least two.
      /* natGateways: 0 is the most important line in this stack.
         With no NAT, nothing in a private subnet can reach the internet —
         which is fine here, because nothing needs to. The Lambdas talk to
         RDS inside the VPC and to AWS services through VPC endpoints. */
      natGateways: 0,
      subnetConfiguration: [
        { name: "public", subnetType: ec2.SubnetType.PUBLIC, cidrMask: 24 },
        // ISOLATED, not PRIVATE_WITH_EGRESS: the latter implies a NAT.
        { name: "isolated", subnetType: ec2.SubnetType.PRIVATE_ISOLATED, cidrMask: 24 },
      ],
    });

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
      vpcSubnets: { subnetType: ec2.SubnetType.PRIVATE_ISOLATED },
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
      vpcSubnets: { subnetType: ec2.SubnetType.PRIVATE_ISOLATED } as ec2.SubnetSelection,
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


    const redirectUrl = redirectFn.addFunctionUrl({
      authType: lambda.FunctionUrlAuthType.NONE,
    });

    const distribution = new cloudfront.Distribution(this, "RedirectCdn", {
      defaultBehavior: {
        origin: new origins.FunctionUrlOrigin(redirectUrl),
        // Redirects must never be cached at the edge. The product promise is
        // "print it once, change where it points forever" — a cached 302 makes
        // a destination edit invisible to anyone who already clicked.
        cachePolicy: cloudfront.CachePolicy.CACHING_DISABLED,
        originRequestPolicy: cloudfront.OriginRequestPolicy.ALL_VIEWER_EXCEPT_HOST_HEADER,
        viewerProtocolPolicy: cloudfront.ViewerProtocolPolicy.REDIRECT_TO_HTTPS,
        allowedMethods: cloudfront.AllowedMethods.ALLOW_GET_HEAD_OPTIONS,
      },
      // CloudFront-Viewer-Country is what makes country routing work without
      // storing an IP address anywhere. PriceClass 100 keeps egress cheapest.
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
    new CfnOutput(this, "DatabaseSecretArn", {
      value: database.secret?.secretArn ?? "(none)",
      description: "Postgres credentials. Generated by CloudFormation; never in this repo.",
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
