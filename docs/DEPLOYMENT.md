# Deploying SnapURL

The frontend and the backend deploy separately and have almost nothing in
common operationally. That is deliberate — see [ARCHITECTURE](./ARCHITECTURE.md)
for why the redirect path and the dashboard are treated as different systems.

This document covers the **frontend on Vercel** and the **backend** — both the
container images that run anywhere Node 22 runs and the AWS serverless profile
in `infra/`. The AWS profile is the experimental one: its adapters and CDK shape
are built and CI/synth-proven, but no real `cdk deploy` has run against a real
account yet, so by the epic's rule (a profile without a green smoke run in CI is
documented as experimental) it is treated as such. See
[ARCHITECTURE](./ARCHITECTURE.md) for the ports-and-adapters core and the three
deployment profiles.

---

## Frontend → Vercel

### Set Root Directory to `web`

This is the one setting that decides whether the deploy works at all.

Vercel detects the framework by reading the **Root Directory's**
`package.json`. The repository root has no dependencies at all — `next` lives
in `web/package.json` — so pointing Root Directory at the repo root fails
before it builds anything:

```
Error: No Next.js version detected. Make sure your package.json has "next"
in either "dependencies" or "devDependencies".
```

Set Root Directory to **`web`**. Vercel still finds `pnpm-workspace.yaml` at
the repository root and installs the whole workspace from there, so
`@snapurl/contract` and `@snapurl/domain` resolve normally.

`vercel.json` therefore lives at `web/vercel.json` — Vercel reads it from the
Root Directory, not from the repository root.

### How the workspace packages get built

`web/` depends on two local packages that must be compiled before Next.js can
type-check against them. Vercel runs a `vercel-build` script in preference to
`build` when one exists, so the whole recipe lives in `web/package.json`:

```json
"vercel-build": "pnpm --filter @snapurl/contract build && pnpm --filter @snapurl/domain build && next build"
```

Keeping it there rather than in a `buildCommand` means the exact sequence
Vercel runs is also runnable locally with `pnpm vercel-build` — a build command
that only ever executes on Vercel is a build command nobody can debug.

The `ignoreCommand` skips a rebuild when a commit touched only backend files,
so a change to `apps/worker` does not redeploy the dashboard. It uses git's
`:/` pathspec prefix, which resolves from the repository root regardless of
the directory Vercel runs it from.

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

### Continuous deployment, and what actually gates it

The Vercel project is connected to the GitHub repository, so deploys are
triggered by pushes, not by a workflow in this repo:

| Trigger | Result |
| --- | --- |
| push to `main` | production deploy |
| open/update a pull request | preview deploy on its own URL |

**Vercel does not wait for GitHub Actions.** A preview builds even when
`verify.yml` is red — the two run in parallel and neither knows about the
other. That is fine for previews and would be dangerous for production, which
is why the gate is somewhere else: `main` is a protected branch requiring the
`Type-check, build, test` check to pass before anything can merge. Nothing
reaches `main` without CI, so nothing reaches production without CI.

If that protection is ever removed, this becomes an unguarded pipeline. The
branch rule *is* the deployment gate.

There is deliberately no `vercel deploy` step in `.github/workflows/`. Adding
one alongside the Git integration would deploy every commit twice, and the
second deploy would race the first.

### Not deploying when nothing changed

`web/vercel.json` sets an `ignoreCommand`:

```
git diff --quiet HEAD^ HEAD -- :/web :/packages :/pnpm-lock.yaml
```

Exit 0 means "nothing relevant changed, skip the build". A commit touching only
`apps/worker` or `infra/` therefore does not redeploy the dashboard.

The `:/` prefix is a git pathspec magic word meaning "relative to the
repository root", which is what makes this work from inside `web/`. If the
command errors — a shallow clone with no `HEAD^`, for instance — Vercel builds
rather than skips, which is the right way round for a guard to fail.

### `NEXT_PUBLIC_USE_FIXTURES` must not be set on the project

It is opt-in and defaults to off, so setting it can only do harm: `"true"`
fails the build by design, and `"false"` is redundant. Leave it absent.

Also worth knowing: `NEXT_PUBLIC_*` variables are inlined into the browser
bundle and readable by every visitor. Marking one "Sensitive" in the Vercel
dashboard hides it from you, not from them. Nothing that needs protecting
should ever carry that prefix.

### CORS

The API allows `WEB_ORIGIN` only (`apps/api/src/config/env.ts`). After the
first Vercel deploy, set `WEB_ORIGIN` on the API to the deployed frontend URL
or every request will be blocked by the browser.

Vercel preview deployments get their own generated URLs, so previews will not
be able to reach a production API unless those origins are allowed too. The
simplest honest answer is to point previews at a staging API.

### First deploy checklist

1. Import the repository into Vercel and set **Root Directory to `web`**.
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
what it costs. Deploy-time resolution stays the default; the earlier "reading
either at cold start needs a ~$7/month interface VPC endpoint because there is
no NAT" constraint no longer strictly holds, because the default `natStrategy`
now gives the app Lambdas egress (see [ARCHITECTURE.md](./ARCHITECTURE.md) and
the natStrategy section below) — a runtime SSM/Secrets Manager lookup is now
reachable over the NAT without a dedicated endpoint. That unblocks issue #292
but is deliberately not implemented here.

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
| VPC | 2 AZs, public + isolated subnets. Egress is parameterised by `natStrategy` (default `'instance'`: a t4g.nano NAT instance, ~$3/mo, with the app Lambdas in `PRIVATE_WITH_EGRESS`). `'gateway'` is a managed NAT (~$32/mo); `'none'` keeps the original zero-egress topology. See the natStrategy section below. |
| RDS | PostgreSQL 18, `db.t4g.micro`, single-AZ, 20 GB gp3, always `PRIVATE_ISOLATED` (it never egresses) |
| DynamoDB | `LinkProjectionTable` (PAY_PER_REQUEST, PITR, `linkId` GSI) read by the redirect's `DynamoLinkResolver`; a separate `CacheTable` (TTL on `expiresAt`) backing the shared `CacheStore` — `CACHE_DRIVER=dynamodb` + `CACHE_DYNAMO_TABLE` are set on `redirectFn` |
| SQS | `ClickQueue` for the redirect's `SqsClickSink`, plus a `ClickDlq` dead-letter queue |
| CloudFront | a `KeyValueStore` for the edge fast path (simple links answered at the edge), and a short 1–5s edge TTL cache policy on the redirect behaviour |
| API | Lambda (container image) behind an HTTP API |
| Redirect | Lambda (container image) behind CloudFront. Under the AWS profile (`LINK_PROJECTION=dynamo` + `CLICK_SINK=sqs`) it drops its `vpcSettings` and leaves the VPC entirely |
| Worker | Lambda invoked once a minute by EventBridge for rollups; also drains the `projection_outbox` into the DynamoDB `LinkProjectionTable` and the CloudFront `KeyValueStore`, and consumes `ClickQueue` via an `SqsEventSource` (event source mapping, `reportBatchItemFailures: true`) to write `click_events` |

### The cost model, which dictates every choice above

The account is on the free tier introduced in **July 2025**: $100 in credits,
valid 12 months, and **no 750-hour RDS allowance** — that was part of the old
12-month tier and does not apply to accounts created since.

At this workload Lambda, CloudFront, DynamoDB, SQS and SSM sit inside
always-free tiers that never expire. **Postgres is roughly 92% of the bill**,
and with the default `natStrategy = 'instance'` (a ~$3/month NAT instance) the
total is about **$15.50/month**. The credits are valid for 12 months, but that
is the *validity window*, not how long they last: at ~$15.50/month the $100
balance is exhausted in about **6.5 months** (100 / 15.5 ≈ 6.5), well before the
12-month window closes.

Two decisions follow from that, and both are worth understanding before
changing anything:

**Egress is configurable via `natStrategy`, defaulting to a NAT instance.** A
managed NAT *gateway* costs ~$32/month before a byte moves — more than
everything else in this stack combined, including the database — so it is not
the default. The default is a single t4g.nano NAT *instance* (~$3/month), which
gives the app Lambdas egress for a fraction of the gateway's cost; `'gateway'`
is the one-flag upgrade to per-AZ redundancy, and `'none'` preserves the
original zero-egress topology at $0. RDS always stays `PRIVATE_ISOLATED` (it
never egresses); the app Lambdas move to `PRIVATE_WITH_EGRESS` when NAT is on.
See the natStrategy section below.

**Lambda, not Fargate.** Three Fargate tasks behind an ALB would be roughly
$58/month against Lambda's ~$0 — the credits would be gone in under two months.

### natStrategy: what egress costs and what it enables

`natStrategy` is a stack prop wired from `app.node.tryGetContext('natStrategy')`
in `infra/bin/snapurl.ts`, defaulting to `'instance'`.

| `natStrategy` | Cost | What it is | Egress features |
| --- | --- | --- | --- |
| `'instance'` (default) | ~$3/mo | t4g.nano NAT instance, single AZ | Function |
| `'gateway'` | ~$32/mo | Managed NAT gateway, highly available | Function |
| `'none'` | $0 | The original zero-egress isolated-only topology | Non-functional |

The backend genuinely needs the internet for Safe Browsing, customer webhooks,
Google OAuth (JWKS) and mail. Under `'instance'` and `'gateway'` those work;
under `'none'` they are non-functional by design (the free option for an
operator who does not need them). NAT was chosen over a free egress-only IPv6
IGW because arbitrary customer webhook receivers cannot be relied on to publish
`AAAA` records — see [DECISIONS.md](./DECISIONS.md).

There are two consequences worth calling out:

1. **Config and secrets are resolved at deploy time, not at cold start.** That
   is still the default; the default NAT instance now makes a *runtime*
   SSM/Secrets Manager lookup reachable without a dedicated interface endpoint,
   which unblocks (but does not implement) issue #292. See Configuration above.

2. **Google Safe Browsing, webhooks, OAuth and mail delivery are functional
   only when `natStrategy != 'none'`.** Safe Browsing is also off by default
   without a key (see [DECISIONS.md](./DECISIONS.md) A10).

### The redirect uses AWS SDK adapters and can leave the VPC

The claim that "there is no AWS SDK anywhere in `apps/` or `packages/`" is no
longer true. `@aws-sdk` packages are dependencies of `apps/redirect`,
`apps/worker`, `packages/cache` and `packages/database`. The Postgres paths
(`PostgresLinkResolver` / `PostgresClickSink`) remain the **default** for every
non-AWS profile, but under the AWS profile (`LINK_PROJECTION=dynamo` +
`CLICK_SINK=sqs`) the redirect resolves links from DynamoDB via
`DynamoLinkResolver`, sends clicks to SQS via `SqsClickSink`, salts its visitor
hashes from the shared DynamoDB `CacheStore`, and leaves the VPC entirely
(`redirectFn` drops its `vpcSettings`; `apiFn` and `workerFn` keep theirs).
[ARCHITECTURE.md](./ARCHITECTURE.md) lays out every port and its adapters.

### Abuse protection and the WAF cost, recomputed

Rate limiting the redirect path belongs at a WAF (see
[DECISIONS.md](./DECISIONS.md) assumption 12), and its cost is worth stating
correctly because an earlier draft got the direction wrong. That draft claimed
the marginal cost per 1M redirects would **fall** from $1.57 to ~$1.10 after
adding a WAF. It does the opposite. Caching is effectively disabled for
correctness — the edge TTL is only 1–5s and the browser is sent `no-store` — so
**every** redirect that reaches the distribution is inspected by the WAF. AWS
WAF bills roughly **$0.60 per 1,000,000 requests inspected** (on top of a
separate ~$5/mo per web ACL fixed charge and per-rule charges, which are not
part of the per-1M marginal figure). So the marginal cost per 1M redirects
**rises** from ~$1.57 to about $1.57 + $0.60 ≈ **$2.17 per 1M**. It does not
fall to ~$1.10: a WAF inspects every request, including the ones the edge would
otherwise serve cheaply, and there is no cache absorbing them.

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

### Applying database migrations

**A fresh deploy leaves the database empty.** CloudFormation creates the RDS
instance; it does not create tables. Until migrations run, every API request
fails.

`pnpm db:migrate` cannot do it. RDS is in isolated subnets with
`publiclyAccessible: false`, so there is no route from a laptop to the
database at all — by design, because the alternative is a publicly reachable
database. (The NAT under `natStrategy != 'none'` gives the Lambdas *outbound*
egress; it does not make RDS reachable from a laptop.)

The Lambdas are inside the VPC, so the worker carries the job. Invoke it once
after the first deploy, and again after any deploy that adds a migration:

```bash
aws lambda invoke   --function-name "$(aws cloudformation describe-stacks --stack-name SnapUrl       --query "Stacks[0].Outputs[?OutputKey=='WorkerFunctionName'].OutputValue" --output text)"   --payload '{"task":"migrate"}' --cli-binary-format raw-in-base64-out   /dev/stdout
```

Expect `{"task":"migrate","applied":true,"folder":"..."}`. It is idempotent —
Drizzle records which migrations have run, so a second invocation applies
nothing and returns the same shape.

Migrations are deliberately **not** run on API cold start. Several Lambdas can
cold-start simultaneously, and racing each other for a schema lock is a bad way
to discover that migrations are not serialised. They are also not on the
EventBridge schedule: a migration should run when someone decides to run it,
not while nobody is watching.

#### Backfilling historical partitions after adopting `click_events`

This only applies if you upgraded a deployment that already carried years of raw
click history into the partitioned layout (see the SELF-HOSTING note on
[adopting `click_events` with pre-existing history](../SELF-HOSTING.md#adopting-click_events-with-pre-existing-history)).
A fresh deploy has no history to backfill and can skip this.

Migration `0007` provisions only a recent window of day-partitions when the lock
table is left at its default; older days land in the `DEFAULT` partition. The
worker's `backfill` task drains them into dated partitions in bounded committed
chunks, so the provisioning cost never has to run inside the schema-migration
transaction. Because RDS is reachable only from inside the VPC, it runs through
the same Lambda as `migrate`. Invoke it once, after the migrate step:

```bash
aws lambda invoke   --function-name "$(aws cloudformation describe-stacks --stack-name SnapUrl       --query "Stacks[0].Outputs[?OutputKey=='WorkerFunctionName'].OutputValue" --output text)"   --payload '{"task":"backfill"}' --cli-binary-format raw-in-base64-out   /dev/stdout
```

Expect `{"task":"backfill","provisioned":N,"chunks":M}`. It is idempotent (an
already-attached day is never re-provisioned), so if the invocation is
interrupted (the Lambda's timeout is minutes, a very large history may need more
than one call) just invoke it again and it resumes with the days still missing.
The per-chunk size follows `CLICK_EVENTS_BACKFILL_CHUNK_DAYS` (default `200`), or
pass `{"task":"backfill","chunkSize":N}` to override it for a single run.

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

The reasoning and the cost constraints that dictate the shape are recorded in
[DECISIONS.md](./DECISIONS.md). The single most important one:

> Lambda, DynamoDB, CloudFront, SQS and SSM Parameter Store all sit inside
> AWS's always-free tiers at this workload. **Postgres is roughly 92% of the
> bill.** A managed NAT gateway costs about $32/month before a byte moves — more
> than everything else combined — which is why `natStrategy` defaults to a ~$3/mo
> NAT instance instead.

The stack is written and synthesises cleanly; what has not happened is a real
`cdk deploy` against a real account (see "What is verified" above). The apps
also run anywhere Node 22 runs: they read all configuration from the
environment, expose health endpoints (`/api/v1/health` and `/health`), and shut
down their database pools cleanly on `SIGTERM`.

---

## Post-deploy smoke gate

A deploy that produces a 404-on-everything stack passes every unit test and all
of CI, because the two things most likely to be broken — a real slug returning
302 instead of 404, and a country-scoped routing rule matching so
`click_events.country` is populated — only exist once CloudFront is in front of
the origin. `scripts/smoke-redirect.sh` is the answer to "does the deployed
thing actually redirect?": the same assertions run against localhost, the
composed stack, or a real deployed environment, and it exits non-zero if any
one fails.

### The env contract

The script is target-agnostic; it reads where to point itself from the
environment. All of these are optional and default to a local dev stack.

| Variable | Default | Notes |
| --- | --- | --- |
| `API` | `http://localhost:3001/api/v1` | API base URL, including `/api/v1`. |
| `RD` | `http://localhost:3002` | Redirect service base URL. |
| `LINK_DOMAIN` | derived from `RD` | Domain new fixture links are created on. |
| `SMOKE_EMAIL` / `SMOKE_PASSWORD` | unset | Optional; see below. |

`LINK_DOMAIN` is the one that has to be right. It **must equal the API's
`DEFAULT_DOMAIN`**: on register the API seeds exactly one system domain equal
to `DEFAULT_DOMAIN` for the new workspace, and link creation rejects any other
domain with `400 "isn't a domain you can use"`, so a freshly-registered
throwaway user can only create links on `DEFAULT_DOMAIN`. It must *also* match
the `Host` the script sends to `RD`, because the redirect resolver matches on
the domain byte-for-byte and does not strip the port. Deriving it from `RD`
(strip the scheme and any path) keeps both requirements aligned by
construction, as long as the deployment sets `DEFAULT_DOMAIN` to the redirect
host. Set `LINK_DOMAIN` explicitly only when it cannot be derived that way.

By default the script self-registers a unique throwaway user per run. When the
deployed environment has open registration disabled, set `SMOKE_EMAIL` and
`SMOKE_PASSWORD` to a pre-provisioned account instead; that account's workspace
must own `LINK_DOMAIN`. The script creates its own fixture links and `DELETE`s
every one of them on exit, even on failure, so it is safe to point at a real
environment.

### Running it by hand against a deployed URL

```bash
API=https://api.example.com/api/v1 \
RD=https://snap.example.com \
bash scripts/smoke-redirect.sh
```

Add `SMOKE_EMAIL=... SMOKE_PASSWORD=...` if registration is closed, and
`LINK_DOMAIN=...` only if it does not derive correctly from `RD`.

### Deployed mode skips the DB-backed assertions

The script's privacy assertions read the database directly and only run where
the database is reachable (local dev, CI, the composed stack) — that is, where
`DATABASE_URL` is set and Postgres is actually accessible. A deployed CDN does
not expose the database, so those checks are **skipped, not failed**. In that
mode the always-run check that drives a real redirect and then polls
`GET /analytics` until the country appears in the breakdown carries the
`click_events.country` proof instead. That is why the workflow below sets no
`DATABASE_URL`.

### The reusable hook a Phase 7 deploy job calls

`.github/workflows/smoke-deployed.yml` wraps the script as a reusable workflow.
It takes `redirect_base_url` and `api_base_url` (and an optional `link_domain`,
plus optional `smoke_email` / `smoke_password` secrets), runs
`scripts/smoke-redirect.sh` against them, and fails the job when any assertion
fails. An operator can trigger it by hand with `workflow_dispatch`.

It exists so the Phase 7 deploy pipeline (#288/#289) can wire it in as a
post-deploy gate — a job with `needs: deploy` and
`uses: ./.github/workflows/smoke-deployed.yml`, passing the freshly-deployed
URLs — so **a 404-on-everything deploy fails loudly** and a deploy is not
considered successful until this passes. Nothing calls it yet: there is no
deploy workflow today, so it can only be fully exercised once a real deploy
target exists.
