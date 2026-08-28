# Deploying SnapURL

The frontend and the backend deploy separately and have almost nothing in
common operationally. That is deliberate — see [ARCHITECTURE](./ARCHITECTURE.md)
for why the redirect path and the dashboard are treated as different systems.

This document covers the **frontend on Vercel**. The backend on AWS is tracked
separately and is not yet implemented.

---

## Frontend → Vercel

### What Vercel needs to know

SnapURL is a pnpm workspace, and `web/` depends on two local packages that must
be built before it. `vercel.json` at the repository root handles this:

```json
{
  "installCommand": "pnpm install --frozen-lockfile",
  "buildCommand": "pnpm --filter @snapurl/contract build && pnpm --filter @snapurl/domain build && pnpm --filter snapurl-web build",
  "outputDirectory": "web/.next"
}
```

Leave Vercel's **Root Directory** at the repository root, not `web/`. Setting it
to `web/` hides the workspace from pnpm and the contract package will not
resolve.

The `ignoreCommand` skips a rebuild when a commit touched only backend files,
so a change to `apps/worker` does not redeploy the dashboard.

### Required environment variables

| Variable | Required | Notes |
| --- | --- | --- |
| `NEXT_PUBLIC_API_URL` | **Yes** | Absolute URL of the API, including `/api/v1`. Must not be localhost. |
| `NEXT_PUBLIC_USE_FIXTURES` | No | Leave unset. Setting it to `true` is rejected in a production build. |

Both are `NEXT_PUBLIC_*`, which means Next.js **inlines them into the browser
bundle at build time**. They are not runtime configuration: changing
`NEXT_PUBLIC_API_URL` requires a redeploy, not a restart. Nothing secret may
ever be given a `NEXT_PUBLIC_` prefix — it ships to every visitor.

### The build refuses to ship a broken deploy

`web/next.config.ts` fails the build if a production build has no
`NEXT_PUBLIC_API_URL`, or has one pointing at localhost.

This exists because the failure it prevents is invisible. `next.config.ts` used
to carry a `?? "http://localhost:3001/api/v1"` fallback, so a deploy missing
the variable would compile happily and bake localhost into the bundle. Every
visitor's browser would then call *their own machine*, the dashboard would
render empty, and nothing in the logs would explain it.

The same guard rejects `NEXT_PUBLIC_USE_FIXTURES=true`. Fixtures are ~480 lines
of invented workspaces and analytics; a site serving them looks entirely
functional, which is precisely what makes shipping them worse than crashing.

**CI compiles the frontend on every pull request without an API to point at.**
That build sets `SNAPURL_ALLOW_UNCONFIGURED_BUILD=true`, which means "this
output will never be served to anyone." Never set it on a real deploy — it
disables the only thing standing between a missing variable and a silently
broken production site.

### CORS

The API allows `WEB_ORIGIN` only (`apps/api/src/config/env.ts`). After the
first Vercel deploy, set `WEB_ORIGIN` on the API to the deployed frontend URL
or every request will be blocked by the browser.

Vercel preview deployments get their own generated URLs, so previews will not
be able to reach a production API unless those origins are allowed too. The
simplest honest answer is to point previews at a staging API.

### First deploy checklist

1. Import the repository into Vercel; leave Root Directory at the repo root.
2. Set `NEXT_PUBLIC_API_URL` to the deployed API's base URL.
3. Deploy. If it fails, read the error — the guard names the exact variable.
4. Set `WEB_ORIGIN` on the API to the Vercel URL, and restart the API.
5. Sign in. If the dashboard renders but every panel is empty, it is CORS.

---

## Backend → containers

All three services build into production images from a single `Dockerfile`,
selected with a build argument:

```bash
docker build --build-arg APP=api      -t snapurl-api .
docker build --build-arg APP=redirect -t snapurl-redirect .
docker build --build-arg APP=worker   -t snapurl-worker .
```

Roughly 60 MB each. They run as the non-root `node` user, contain no build
tools, no pnpm and no sources — only compiled output and production
dependencies.

### Why one Dockerfile instead of three

The three apps share a workspace, a lockfile and most of their build. Three
near-identical Dockerfiles would drift apart the first time one of them
changed. The genuinely interesting part — pruning a pnpm workspace down to one
deployable app — is identical for all three.

That pruning is `pnpm deploy --legacy --filter @snapurl/<app> --prod`. It
rewrites the workspace links (`@snapurl/contract` and friends) into real
directories, so the image runs with no knowledge that a workspace ever existed.
`--legacy` is required because pnpm 10+ otherwise expects
`inject-workspace-packages=true`, which this workspace does not use.

### Running the whole stack locally

```bash
docker compose --profile full up -d
```

Database, API, redirect service and worker, wired together. The default
(`docker compose up -d postgres`) is still the database alone, because
day-to-day work runs the apps from source with `pnpm dev:*` for hot reload.

The `full` profile is the closest thing to a deployment you can run on a
laptop, and it is how the images get verified: both smoke suites — 72
assertions — pass against it.

Two details worth noting if you write your own compose or task definition:

- Inside the network the database is `postgres:5432`, not `localhost:5433`.
  The host port mapping exists because 5432 is usually already taken.
- `JWT_ACCESS_SECRET` **must match** between the API and the redirect service.
  The redirect verifies unlock tokens the API signed, so a mismatch breaks
  password-protected links silently and nothing else.

Health probes live in the compose file rather than the Dockerfile, because the
three images share one Dockerfile but have different HTTP surfaces: the API is
`/api/v1/health`, the redirect service is `/health`, and the worker has none at
all — its liveness shows up in what it writes to the rollup tables.

---

## Backend → AWS

`infra/` is a CDK v2 stack. Nothing in `apps/` or `packages/` imports it, and
nothing at runtime depends on it.

```bash
cd infra
npx cdk bootstrap                    # once per account/region

# Once per stage: write this stage's configuration to Parameter Store.
../infra/bin/put-parameters.sh /snapurl/prod https://your-app.vercel.app https://snap.to

npx cdk synth                        # writes the template
npx cdk deploy                       # builds and pushes the images, then deploys
```

There is no secret in that command. The database password and both JWT signing
keys are generated into Secrets Manager by the stack itself.

### Configuration

Two stores, split on whether reading a value is harmful.

| | Where | What is in it |
| --- | --- | --- |
| Config | SSM Parameter Store, `/snapurl/<stage>/*` | origins, default domain, log level, mail settings, throttle limits |
| Secrets | Secrets Manager, generated | database password, `JWT_ACCESS_SECRET`, `JWT_REFRESH_SECRET` |

Both are resolved by CloudFormation **at deploy time** and land in the Lambda's
environment. Neither is baked into a container image — the images are built
from the repository alone and contain no configuration, so the same image is
deployable to any stage. [DECISIONS.md](./DECISIONS.md) has the reasoning and
what it costs; the short version is that reading either at cold start needs an
interface VPC endpoint at ~$7/month, because there is no NAT.

The stack has no defaults for the parameters. A missing one fails the deploy
naming the parameter, which is a better time to find out than the first
request; `infra/bin/put-parameters.sh` writes all eight in one command, and
re-running it after editing a value is how a config change is made. The change
takes effect on the next `cdk deploy`.

`-c webOrigin=...` and `-c redirectOrigin=...` still work and take precedence,
for a one-off deploy against a preview URL without editing the stored value and
remembering to put it back.

Two JWT keys, not one, because `apps/api/src/config/env.ts` requires two: if a
single key signed both tokens, a stolen access token could be replayed as a
refresh token and never expire. That is $0.80/month in Secrets Manager, about
5% of what the database costs.

### What it creates

| | |
| --- | --- |
| VPC | 2 AZs, public + isolated subnets, **zero NAT gateways** |
| RDS | PostgreSQL 18, `db.t4g.micro`, single-AZ, 20 GB gp3, isolated subnets |
| API | Lambda (container image) behind an HTTP API |
| Redirect | Lambda (container image) behind CloudFront |
| Worker | Lambda, invoked once a minute by EventBridge |

### The cost model, which dictates every choice above

The account is on the free tier introduced in **July 2025**: $100 in credits,
valid 12 months, and **no 750-hour RDS allowance** — that was part of the old
12-month tier and does not apply to accounts created since.

At this workload Lambda, CloudFront and SSM sit inside always-free tiers that
never expire. **Postgres is roughly 92% of the bill**, about $15/month, so
$100 covers roughly six months.

Two decisions follow from that, and both are worth understanding before
changing anything:

**No NAT gateway.** A NAT costs ~$32/month before a byte moves — more than
everything else in this stack combined, including the database. The standard
"put RDS in a private subnet" tutorial creates one without mentioning it. The
subnets here are `PRIVATE_ISOLATED`, not `PRIVATE_WITH_EGRESS`, because the
latter implies a NAT.

**Lambda, not Fargate.** Three Fargate tasks behind an ALB would be roughly
$58/month against Lambda's ~$0 — the credits would be gone in under two months.

### Two consequences of having no NAT

Lambdas in isolated subnets can reach the database and nothing else. That is
fine, because the application needs nothing else — there is no AWS SDK anywhere
in `apps/` or `packages/`, and the redirect service writes clicks straight to
Postgres via `PostgresClickSink`.

It does mean two things:

1. **Config and secrets are resolved at deploy time, not at cold start.**
   Reading either from inside the VPC would need an interface endpoint
   (~$7/month, about 45% of the database cost) to hide a value from the only
   person who can read a Lambda's configuration anyway. That trade changes the
   moment anyone else has console access to the account; the fix is one
   endpoint and a runtime lookup. See Configuration above.

2. **Google Safe Browsing cannot be called.** It is off by default already
   (see [DECISIONS.md](./DECISIONS.md) A10). Turning it on in this topology
   requires egress, which means a NAT or a proxy.

### Why the images are containers, not zip bundles

The Lambda images share every build stage with the container images verified
locally by `docker compose --profile full`. What runs in Lambda is the same
compiled output whose smoke suite passed, rather than a separately-bundled
approximation of it.

The API and redirect service use the **AWS Lambda Web Adapter**, an extension
that speaks the Lambda runtime API on one side and plain HTTP on the other.
That means neither application contains a single line of Lambda-specific code —
the image starts the same Fastify server compose runs, and the adapter
translates. The alternative (`@fastify/aws-lambda`) would have required
refactoring both entrypoints for a runtime that cannot be tested locally.

The worker has no HTTP surface for an adapter to translate, so it uses AWS's
own Node base image and a handler that calls the same two functions the
long-running process calls on its interval.

### What is verified, and what is not

**Verified:** the stack type-checks, synthesises with zero validation
violations, and produces a template in which every secret is a CloudFormation
dynamic reference rather than a literal. The container images build and pass
both smoke suites (72 assertions) under `docker compose --profile full`.

**Not verified:** an actual deployment. Deploying costs real money in a real
account, so nobody has run `cdk deploy` against this stack yet. Treat the first
deploy as a test.

Two of the three things that were most likely to break on it have since been
dealt with, and are worth knowing about because both were silent:

- **The adapter's readiness check.** Its default path is `/`, which the API does
  not serve — everything is under `/api/v1` — so every cold start waited out the
  readiness timeout before serving a request. Both web Lambdas now name their own
  health endpoint.
- **RDS connection limits.** `DATABASE_POOL_MAX` was set on all three functions
  but only the API read it; the redirect service and worker had 5 and 4
  hardcoded. On a `db.t4g.micro`, five connections per concurrent Lambda
  instance exhausts the server quickly. Both now honour the variable, keeping
  their previous values as the default for the long-running process.

The shape it should take, and the cost constraints that dictate it, are
recorded in [DECISIONS.md](./DECISIONS.md). The single most important one:

> Lambda, DynamoDB, CloudFront, SQS and SSM Parameter Store all sit inside
> AWS's always-free tiers at this workload. **Postgres is roughly 92% of the
> bill.** A NAT Gateway costs about $32/month before a byte moves — more than
> everything else combined — and the standard "put RDS in a private subnet"
> tutorial creates one.

Until that work lands, the apps run anywhere Node 22 runs. They read all
configuration from the environment, expose health endpoints
(`/api/v1/health` and `/health`), and shut down their database pools cleanly on
`SIGTERM`.
