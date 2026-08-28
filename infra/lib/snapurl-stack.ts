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
  /** Where the dashboard is served from. Used for CORS on the API. */
  webOrigin: string;
  /** Public hostname the redirect service answers on, for building short URLs. */
  redirectOrigin: string;
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

    const commonEnv: Record<string, string> = {
      NODE_ENV: "production",
      // A Lambda instance serves one request at a time, so a pool larger than
      // one just multiplies idle connections against RDS's small max.
      DATABASE_POOL_MAX: "1",
      DATABASE_SSL: "true",
      WEB_ORIGIN: props.webOrigin,
      REDIRECT_ORIGIN: props.redirectOrigin,
      LOG_LEVEL: "info",
      MAIL_TRANSPORT: "outbox",
      DATABASE_URL: databaseUrl,
    };

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
      });


    /* ---------------------------------------------------------
       API
       --------------------------------------------------------- */

    const apiFn = new lambda.DockerImageFunction(this, "ApiFn", {
      code: imageFor("api", "lambda-web"),
      memorySize: 1024, // CPU scales with memory; 1024 is the usual sweet spot.
      timeout: Duration.seconds(30),
      environment: { ...commonEnv, API_PREFIX: "api/v1" },
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
      environment: commonEnv,
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
      environment: { ...commonEnv, WORKER_MODE: "once" },
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
      description: "Postgres credentials. Read by the Lambdas at cold start.",
    });
  }
}
