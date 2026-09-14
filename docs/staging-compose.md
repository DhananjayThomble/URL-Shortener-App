# Cost-near-zero compose staging for SnapURL

> **Status:** PLAN (Round 1). Nothing in this document is built yet. It is the
> investigation and design for a pre-prod, compose-only staging environment —
> the cheap arm of the #267 deployment-profiles epic. It adds **no AWS
> resources**: everything runs in `docker-compose` on one host.

## 1. What "staging" means here, and why it is cheap

The goal is a **pre-prod environment that runs the full stack via
docker-compose** so integration / migration / wiring bugs are caught *before* a
prod deploy, at essentially zero marginal cost (local containers, no cloud
spend). It is deliberately the **single-node / Postgres-adapter** shape of the
app, not the AWS serverless shape — see §3 for the sharp boundary that creates.

The important discovery of this investigation is that **most of this already
exists**, in two places:

1. **`docker-compose.yml` already has a `full` profile** that builds and runs
   `api + redirect + worker` against `postgres`, wired end to end. `pnpm db:up`
   is just `docker compose up -d postgres` (the DB alone); `--profile full`
   brings up the whole server stack.
2. **CI already stands that stack up as a gate.** `verify.yml`'s
   `integration` job (`Compose integration harness`) does exactly what a
   staging smoke should: bring up postgres → `pnpm db:migrate` → `docker compose
   --profile full up -d --build --wait` → run `scripts/smoke.sh` +
   `scripts/smoke-redirect.sh` + `scripts/integration-assertions.sh` → dump logs
   → `docker compose --profile full down -v`.

So this is **not a greenfield build**. It is a thin, honest delta: turn the
existing `full` profile + smoke scripts into a *named, developer-runnable,
data-isolated staging environment* with the loopholes below closed, plus decide
whether to add the one thing genuinely missing (a containerised **web**
service).

## 2. Existing compose surface and the delta

| File | Purpose | Services | Migrations | Web | Secrets |
|------|---------|----------|------------|-----|---------|
| `docker-compose.yml` (repo root) | dev/CI. `pnpm db:up` = postgres only; `--profile full` = whole server stack | postgres, api, redirect, worker (all `profiles: ["full"]` except postgres) | **none built in** — CI runs `pnpm db:migrate` from host against the container DB | **absent** | throwaway inline values (`local-compose-*-secret-…`) |
| `deploy/single-node/docker-compose.yml` | Profile-1 self-hosting (GHCR images + Caddy TLS) | postgres, api, redirect, worker, caddy, + `migrate` one-shot (`profiles: ["migrate"]`) | **`migrate` one-shot** under its own profile (`node -e runMigrations`) | **absent** | all from `.env` via `init.sh`, no localhost defaults |

**How `pnpm db:up` / `pnpm dev:*` relate:** `db:up` starts just Postgres so
developers run the apps from source with hot reload (`pnpm dev:api|web|redirect|
worker`). The `full` profile is the opposite — it runs the apps *as built
container images*, the closest thing to a deployment you can run on a laptop.
Staging wants the container path (it is what proves the images work), not the
`dev:*` source path.

**Delta from `--profile full` to a full-stack staging compose:**

- **api + redirect + worker + postgres, all wired** → **already done** in the
  `full` profile. The adapters are the Postgres/in-memory set (see §3).
- **migrations run automatically on `up`** → **not done.** Today CI migrates
  from the host (`pnpm db:migrate`) *before* `--profile full up`, because the
  server images run `NODE_ENV=production`, do **not** auto-migrate, and
  `depends_on postgres: service_healthy` — so they crash-loop against an
  unmigrated DB. Staging needs a **`migrate` one-shot service** (mirroring the
  single-node file) that `api`/`redirect`/`worker` depend on, so a single
  `docker compose up` is correct with no host step. (Closes loophole (c).)
- **web** → **not done, and there is no `web/Dockerfile`.** Web ships via
  Vercel in prod; it has never been containerised. This is the one real *build*
  and the one real *decision* (see §4a and §6 / Decision D1).
- **data isolation** → **partly.** Both compose files name the volume
  `snapurl-pgdata`, but the dev file's compose *project name* is `snapurl` and
  the host port is `5433`. Staging must use a **separate project name + separate
  named volume + a different host port (or no host port)** so a staging run
  never reads or clobbers dev data. (Closes loophole (b).)
- **health/readiness + core-journey verification** → **already done** by the
  smoke scripts (see §3, §4e).
- **teardown that removes the volume** → **the command exists** (`down -v`);
  staging should wrap it so it is one obvious step. (Closes loophole (f).)

## 3. THE core loophole: ports, adapters, and which half staging exercises

SnapURL is ports-and-adapters. The seams and their adapters (read from
`apps/redirect/src/main.ts`, `apps/worker/src/main.ts`,
`apps/api/src/mail/mail.service.ts`, `apps/api/src/config/env.ts`):

| Port (seam) | Selector env | **Compose/staging adapter** | **AWS-prod adapter** | Single-node prod adapter |
|-------------|--------------|------------------------------|----------------------|--------------------------|
| **LinkResolver** (redirect reads link config) | `LINK_PROJECTION` | `PostgresLinkResolver` (reads Postgres directly) — unset/`none` | `DynamoLinkResolver` (reads the DynamoDB projection) — `dynamo` | `PostgresLinkResolver` |
| **ClickSink** (where a click goes) | `CLICK_SINK` | `PostgresClickSink` (INSERT into `click_events`) — unset/`postgres` | `SqsClickSink` (SendMessage to `ClickQueue`, worker drains it) — `sqs` | `PostgresClickSink` |
| **ProjectionTarget** (worker outbox drain) | `LINK_PROJECTION` | `NoProjection` (no-op; redirect reads Postgres, nothing to project) | `DynamoProjection` (+ optional `KvsWriter` on `LINK_PROJECTION_KVS_ARN` for the CloudFront edge) | `NoProjection` |
| **CacheStore** (hot-link + rate-limit + salt) | `CACHE_DRIVER` | `memory` (per-instance) | `dynamodb` (`CACHE_DYNAMO_TABLE`) | `memory` |
| **SaltSource** | derived | `PostgresSaltCache` (`daily_salts` table) | `CacheStoreSaltCache` (shared DynamoDB) when off-Postgres | `PostgresSaltCache` |
| **MailerPort** | `MAIL_TRANSPORT` | `outbox` (writes `.txt` to a dir) | `ses` (Amazon SES) | `outbox` (default) or `ses` |

**The honest consequence, stated sharply so nobody misreads a green staging:**

> **Compose staging exercises the *Postgres/in-memory* adapters — the same code
> path as single-node self-hosting (Profile 1). It does NOT exercise the
> DynamoDB projection, the SQS click queue, the shared DynamoDB cache/salt, or
> SES. Those are the AWS-prod (Profile 3) adapters, and they are what actually
> serve `app.snapurl.in` today.**

Per-port decision for staging (what staging MUST exercise realistically):

- **Worker scheduled jobs — MUST fire, and they do.** The compose `worker`
  service runs `node dist/main.js`, i.e. the long-lived loop (not the `--once`
  Lambda path), so `runProjection`, `runFrequent` (rollup + webhooks) and
  `runMaintenance` fire on `setInterval` timers — `ROLLUP_INTERVAL_SECONDS`
  (default 30s), `PROJECTION_INTERVAL_SECONDS`, `MAINTENANCE_INTERVAL_SECONDS`
  (3600s). This **mirrors prod's EventBridge schedule** functionally: the same
  exported job functions run, only the scheduler differs (in-process timer vs
  EventBridge rule). `scripts/integration-assertions.sh` proves the live worker
  actually folds a real click from `click_events` into `click_daily` within ~90s
  — the one thing no unit test can. (Closes loophole (d).)
- **Redirect MUST resolve real links** — it does, via `PostgresLinkResolver`
  against the staging Postgres. `smoke-redirect.sh` drives 12 fixture links
  through the container and asserts 302/301/404, query+UTM merge, routing chain,
  gates, deep-linking, and privacy.
- **Mailer — `outbox` is the right staging choice.** Note: there is **no SMTP
  transport** in the code (only `outbox` and `ses`), so a maildev/mailhog
  container **cannot be wired without new code**. `outbox` writes each message
  to a file, which lets invite / password-reset / verify emails be inspected
  end to end without a provider. **Decision D2** below asks whether adding an
  SMTP transport + mailhog is in scope (it is a code change, not just compose).

## 4. What compose staging CAN and CANNOT cover

**CAN cover (this is the value):**

- Database **migrations** apply cleanly on a fresh volume (drizzle `runMigrations`).
- **Service integration**: api ↔ postgres, redirect ↔ postgres, worker ↔ postgres,
  and the api↔redirect shared-`JWT_ACCESS_SECRET` contract (unlock tokens).
- **Projection/rollup wiring** end to end: a real redirect writes `click_events`,
  the live worker rolls it into `click_daily` (integration-assertions.sh).
- **Redirect resolution** and the full routing/gate/UTM/deep-link/query surface
  (smoke-redirect.sh, ~50 assertions).
- **Auth** (register, me, refresh rotation + reuse-revocation, 2FA setup,
  password-protected unlock), **the web↔api contract** (once web is added), and
  the whole API contract (smoke.sh, ~150 assertions).

**CANNOT cover — the boundary, named so green staging is never mistaken for a
safe edge deploy:**

> Compose staging does **NOT** exercise the **CloudFront / Lambda EDGE** path:
> - the **KVS fast path** (`LINK_PROJECTION_KVS_ARN` → `KvsWriter` →
>   CloudFront KeyValueStore read by the edge function),
> - the **OAC invoke grant** (`lambda:InvokeFunction` + `InvokeFunctionUrl`)
>   that keeps the origin reachable only through CloudFront,
> - **viewer-country header injection** (CloudFront overwrites
>   `CloudFront-Viewer-Country` from the caller IP — a compose run passes a
>   spoofed value straight through, which is *why* the country-routing smoke
>   assertions are gated on `CAN_SPOOF_COUNTRY=DB_AVAILABLE`),
> - the **edge query-string merge** re-serialised by the CloudFront Function,
> - **SES** mail delivery, the **SQS** click queue, the **DynamoDB** projection
>   and shared cache.
>
> Those are **CDN/Lambda-only** and are covered by the **deployed smoke test**
> (`.github/workflows/smoke-deployed.yml`, driving `scripts/smoke-redirect.sh`
> against the real CloudFront-fronted prod URLs). **A green compose staging is
> NOT evidence that an edge change is safe to deploy.** Edge changes are gated
> only by the deployed smoke run against prod.

## 5. Loophole checklist (the user's explicit asks) — how each is closed

| # | Loophole | How staging closes it |
|---|----------|------------------------|
| (a) | **Config drift** | Commit **`.env.staging.example`** (no real secrets): randomized-looking but throwaway `JWT_ACCESS_SECRET`/`JWT_REFRESH_SECRET` (≥32 chars, **identical between api and redirect** or unlock breaks), `MAIL_TRANSPORT=outbox`, `CACHE_DRIVER=memory`, `LINK_PROJECTION`/`CLICK_SINK` unset (Postgres path), `TRUSTED_PROXY_HOPS=0`. Web: `NEXT_PUBLIC_API_URL` points at the **staging api**, satisfying `web/next.config.ts` (see D1 — the guard rejects a localhost URL in a `NODE_ENV=production` build). |
| (b) | **Data isolation** | Separate compose **project name** (`snapurl-staging`), a **distinct named volume** (`snapurl-staging-pgdata`), and a **different host port** (e.g. `5435:5432`) or no published port. A staging run never touches dev's `snapurl` project / `snapurl-pgdata` / `5433`. |
| (c) | **Migrations auto-run on up, idempotent** | Add a **`migrate` one-shot service** (mirror `deploy/single-node`: `node -e "runMigrations(...)"` on the worker image, `restart: "no"`), and make api/redirect/worker `depends_on: migrate: {condition: service_completed_successfully}`. `runMigrations` is idempotent (drizzle skips applied migrations), so re-`up` is safe. |
| (d) | **Worker scheduled jobs actually fire** | The compose worker runs the **timer loop** (not `--once`), so projection-drain + rollup fire on `setInterval`, mirroring EventBridge. Proven by `integration-assertions.sh` (click → `click_events` → `click_daily` in ~90s). No cron container needed. |
| (e) | **Health / readiness + CORE-journey verification** | api/redirect have compose **healthchecks** (`/api/v1/health`, `/health`); `--wait` blocks on them. But liveness ≠ verification — the documented "is staging really up?" step is **`scripts/smoke.sh` + `scripts/smoke-redirect.sh`**, which *create a link via the staging API and FOLLOW it, asserting 3xx + exact `Location`* (our deploy-verification rule), plus `integration-assertions.sh` for the rollup. |
| (f) | **Reproducible teardown (removes volume)** | `docker compose -p snapurl-staging --profile full down -v` drops the containers **and** the staging volume, so the next `up` starts from a fresh migrated DB. Wrap as a one-liner / `pnpm staging:down`. |
| (g) | **Rate-limiter + bot-filter parity** | Document: the throttler is active (`THROTTLE_LIMIT=120/60s` default) — a burst of >120 req/60s returns 429 (correct behavior, not a bug). The rollup counts only `is_bot=false AND blocked_reason IS NULL`, so **click checks must use a real browser UA** (the smoke scripts already hardcode a Chrome UA and warn never to revert to curl's default). |

## 6. Proposed PR breakdown

Given how much already exists, this is intentionally small. **PR1 is the whole
staging environment**; PR2/PR3 are optional.

- **PR1 — `feat/staging-compose` (this branch): the staging environment. SHIPPED.**
  - `docker-compose.staging.yml`: a SEPARATE file (not a profile on the root
    file, so dev's `:5433` and CI's `integration` job stay untouched) — project
    `snapurl-staging`, volume `snapurl-staging-pgdata`, Postgres host port
    `5435`, a `migrate` one-shot, api/redirect/worker wired. **Web is NOT here**
    (D1: run on the host via `pnpm dev:web`).
  - `.env.staging.example` (loophole (a)) + `.gitignore` entries (`.env.staging`
    ignored, `.env.staging.example` tracked).
  - `staging:up` / `staging:smoke` / `staging:logs` / `staging:down` scripts,
    reusing `scripts/smoke.sh` + `scripts/smoke-redirect.sh` +
    `scripts/integration-assertions.sh` unchanged for the core-journey gate.
  - The runbook (§8) and this boundary doc.
- **PR2 — SMTP mail transport + mailhog: DROPPED (D2).** Staging keeps `outbox`,
  which covers email generation; SMTP delivery is not exercised. Would need new
  code (there is no SMTP transport), so it is out of scope.
- **PR3 — separate CI staging gate: DROPPED (D3).** The existing `verify.yml`
  `integration` job already gates every PR on the full compose stack; no distinct
  staging-profile job is added.

## 7. Decisions — RESOLVED (2026-09-14) and shipped

All three were approved as the recommended defaults and are built in this PR:

- **D1 — Web runs on the HOST via `pnpm dev:web`.** No `web/Dockerfile`, no web
  container. `pnpm dev:web` runs Next in development mode, so the
  `web/next.config.ts` production guard is inert and
  `NEXT_PUBLIC_API_URL=http://localhost:3001/api/v1` is correct (the browser is
  on the host that publishes `api:3001`). See the runbook below.
- **D2 — Mailer stays `outbox`.** Emails are written to files inside the api
  container (`/tmp/snapurl-outbox`), exercising generation. **SMTP delivery is
  NOT exercised** — there is no SMTP transport in the code (only `outbox` +
  `ses`), so mailhog/maildev would need new code and is out of scope.
- **D3 — The existing `verify.yml` `integration` job stays the gate.** No new
  staging-profile CI job. That job already brings up the root `--profile full`
  stack, migrates, runs all three smoke suites and tears down on every PR.

## 8. Runbook — how to run compose staging

The delta lives in `docker-compose.staging.yml` (a **separate** file from the
dev/CI root `docker-compose.yml`, so dev's `:5433` and the CI `integration` job
are untouched), `.env.staging.example`, and `staging:*` scripts in
`package.json`.

```bash
# 0. one-time: copy the throwaway env template (optional — the stack has safe
#    defaults baked in and comes up with no .env.staging present)
cp .env.staging.example .env.staging

# 1. bring the stack up from clean — builds the images, runs the `migrate`
#    one-shot to apply the schema, then starts api + redirect + worker.
#    --wait blocks on the api/redirect healthchecks (the worker has none).
pnpm staging:up

# 2. start web on the HOST against staging (decision D1). Dev mode, so the
#    next.config.ts prod guard is inert and a localhost API URL is correct.
NEXT_PUBLIC_API_URL=http://localhost:3001/api/v1 pnpm dev:web

# 3. VERIFY the core journey — the "is staging really up?" step. Liveness is
#    not verification; these create a link via the staging API and FOLLOW it
#    (exact Location), with a real browser UA, and prove the live worker rolls a
#    click from click_events into click_daily.
pnpm staging:smoke     # smoke.sh + smoke-redirect.sh + integration-assertions.sh

# tail logs while debugging
pnpm staging:logs

# 4. TEARDOWN — removes the containers AND the staging volume, so the next
#    `up` starts from a fresh migrated database. Reproducible by construction.
pnpm staging:down
```

**Data isolation:** staging uses compose project `snapurl-staging`, volume
`snapurl-staging-pgdata`, and Postgres host port **5435** — none of which touch
dev's `snapurl` project / `snapurl-pgdata` / `5433`. `staging:down`'s `-v` wipes
only the staging volume.

**Migrations-on-up:** the `migrate` one-shot (worker image,
`runMigrations`, `restart: "no"`) runs before api/redirect/worker via
`depends_on … condition: service_completed_successfully`, so a single
`pnpm staging:up` is correct with no host `pnpm db:migrate`. Drizzle records
applied migrations, so re-`up` migrates nothing (idempotent).

**Worker scheduler:** the compose worker runs `node dist/main.js` (the timer
loop, not `--once`), so the projection drain + rollup fire on their intervals —
mirroring prod's EventBridge and closing the loophole that otherwise silently
reproduces the 404-window / clicks-stay-0 bugs.

**Rate-limiter / bot-filter parity:** the throttler is active
(`THROTTLE_LIMIT=120/60s`); a burst over that returns 429 (correct, not a bug).
The rollup counts only `is_bot=false AND blocked_reason IS NULL`, so the smoke
scripts drive clicks with a real Chrome UA — never curl's default (a bot UA).
