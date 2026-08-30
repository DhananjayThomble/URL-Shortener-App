# Deploying SnapURL

The frontend and the backend deploy separately and have almost nothing in
common operationally. That is deliberate — see [ARCHITECTURE](./ARCHITECTURE.md)
for why the redirect path and the dashboard are treated as different systems.

This document covers the **frontend on Vercel**. The backend on AWS is tracked
separately and is not yet implemented.

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

### Applying database migrations

**A fresh deploy leaves the database empty.** CloudFormation creates the RDS
instance; it does not create tables. Until migrations run, every API request
fails.

`pnpm db:migrate` cannot do it. RDS is in isolated subnets with
`publiclyAccessible: false`, so there is no route from a laptop to the
database at all — by design, because the alternative is a NAT gateway or a
publicly reachable database.

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
