# Self-hosting SnapURL (single-node profile)

This is the guide for running SnapURL on one machine, behind your own domain,
with automatic TLS. It is Profile 1 from the architecture epic: one host, one
Postgres, [Caddy](https://caddyserver.com/) for TLS, and the three server images
pulled from GHCR rather than built locally.

Everything for this profile lives under [`deploy/single-node/`](./deploy/single-node/).
That directory is intentionally separate from the repo-root
[`docker-compose.yml`](./docker-compose.yml), which is the dev/CI file (built
from source, throwaway secrets, host ports). Do not confuse the two.

Follow the steps in order. A clean machine goes from `git clone` to a working
shortener on a real domain with TLS by following this document only.

## 1. Prerequisites

- A Linux host with **Docker** and the **`docker compose` v2** plugin installed.
- A **domain you control**, with two public DNS records pointing at this host's
  public IP:
  - `APP_DOMAIN` (the dashboard + API host), for example `app.example.com`
  - `SHORT_DOMAIN` (the short-link host), for example `snap.example.com`

  Create an **A record** for each (and an **AAAA record** too if the host has a
  public IPv6 address). Both names must resolve to this host before you start,
  or Caddy cannot obtain certificates.
- **Ports 80 and 443 open** to the internet on this host. Caddy uses them for
  the ACME HTTP and TLS-ALPN challenges that issue and renew the certificates.
  These are the only ports the stack publishes.

## 2. Get it

```bash
git clone https://github.com/DhananjayThomble/URL-Shortener-App.git
cd URL-Shortener-App/deploy/single-node
```

Every command from here on runs from `deploy/single-node/`.

## 3. Configure

The whole configuration is a single `.env` file. Its documented contract is
[`.env.example`](./deploy/single-node/.env.example), which ships with no secret
defaults. Run the bootstrap script, which copies the example to `.env` (the same
as `cp .env.example .env`) and then generates the empty secret fields for you:

```bash
./init.sh
```

`init.sh` is idempotent and safe to re-run. It fills only the empty secret
fields (`POSTGRES_PASSWORD`, `JWT_ACCESS_SECRET`, `JWT_REFRESH_SECRET`), never
overwrites values that are already set, ensures the two JWT secrets differ, and
never prints the generated secrets. Nothing is echoed; the values only ever
land in `.env`, so keep that file private.

Then edit `.env` and set the values that are yours to choose:

```bash
$EDITOR .env
```

- `APP_DOMAIN` and `SHORT_DOMAIN`: the two domains from the prerequisites.
- `ACME_EMAIL` (optional but recommended): your contact email for Let's Encrypt,
  so the CA can warn you about expiries. Leave blank to skip.
- `MAIL_TRANSPORT` (optional): defaults to `outbox`, which writes each message
  to a file in a local outbox directory (`os.tmpdir()/snapurl-outbox` by
  default, override with `MAIL_OUTBOX_DIR`) instead of sending it. On this
  compose that directory is inside the `api` container and is ephemeral unless
  you mount a volume for it; a real deployment configures SES or another
  transport instead.

About the JWT secrets: `init.sh` generates each as 64 hex characters, which is
well over the minimum. Each secret **must stay at least 32 characters** or the
API's zod config schema fails fast at boot. The API signs JWTs and the redirect
service verifies them, so both services read the **same** `JWT_ACCESS_SECRET`;
the compose file already wires that one variable into both, so just keep it
consistent and do not blank it out.

## 4. Pull and start

Pull the published images from GHCR, then start the stack in the background:

```bash
docker compose pull
docker compose up -d
```

Only the `caddy` service publishes ports (80 and 443). Postgres, the API, the
redirect service, and the worker have no host ports; they are reachable only on
the internal compose network, and Caddy reverse-proxies inward to them.

## 5. Migrate

Apply the database schema with the one-shot `migrate` service. It lives under
the `migrate` profile, so `docker compose up -d` never runs it implicitly:

```bash
docker compose --profile migrate up migrate
```

This applies the migrations under `packages/database` against the Postgres
volume, then exits. Run it once before first use, and again after every upgrade
(see [Upgrade](#8-upgrade)).

### Adopting `click_events` with pre-existing history

A fresh install has nothing to worry about here: migrations apply against empty
tables and finish in a moment. This section is only for an operator who already
has years of raw click data in a `click_events` table and is now upgrading to
the partitioned layout. If that is not you, skip to [Verify TLS](#6-verify-tls).

The migration that converts `click_events` into a day-partitioned table
(`0007_partition_click_events`) runs as a **single transaction**. For its whole
duration it holds:

- `ACCESS EXCLUSIVE` on `click_events` (it renames the table aside, provisions
  partitions, copies the data, and drops the old table), so **every click write
  blocks** until it commits.
- `SHARE ROW EXCLUSIVE` on `links` and `workspaces` (it re-adds the two foreign
  keys), so **creating or editing a link stalls** for the duration too.

Neither the connection pool nor the migrator sets a `statement_timeout`, so the
transaction runs to completion however long the copy takes. **Run the migrate
step in a maintenance window**, sized to how much raw click history you are
carrying, and expect both click ingestion and link create/edit to be paused
while it runs.

**Sizing `max_locks_per_transaction`.** Because the migration attaches one day
partition per day of history inside that one transaction, and each attached
partition costs roughly **5 lock slots** (the relation plus its cloned indexes),
the shared lock table can be exhausted by a long history. That table holds
`max_locks_per_transaction * (max_connections + max_prepared_transactions)`
slots, which is `6400` on a default configuration
(`max_locks_per_transaction=64`, `max_connections=100`,
`max_prepared_transactions=0`). At about 5 slots per day, **roughly 3.5 years of
history approaches that ceiling** and more will exceed it, aborting the migration
with `out of shared memory`. If your history is near or past that, raise
`max_locks_per_transaction` in `postgresql.conf` before running the migrate step
(it requires a restart), then lower it again afterwards if you like.

**Provision the historical partitions after the structural migration, not
inside it.** Rather than sizing the lock table for your entire history, you can
let `0007` create only the recent window and provision the older days
afterwards, in bounded committed chunks, so the provisioning phase never needs a
raised `max_locks_per_transaction`. The worker ships a one-time backfill routine,
`backfillClickPartitions`, for exactly this. It drives the
`click_events_backfill_days` helper (added in `0015_click_events_backfill_days`)
in a loop where **each chunk is its own committed transaction**, so locks release
between chunks and the footprint stays bounded no matter how old the database is.
The chunk size is set by **`CLICK_EVENTS_BACKFILL_CHUNK_DAYS`** (default `200`),
chosen so a chunk of 200 day-partitions costs about `1000` lock slots, well under
the default `6400` ceiling. Because it is a one-time adoption or repair step and
not part of steady-state maintenance, it is not wired into the worker's hourly
loop; trigger it once, after the migrate step, and re-run it if it is
interrupted (it is idempotent and will only provision the days that are still
missing). Raise `CLICK_EVENTS_BACKFILL_CHUNK_DAYS` only if you have also raised
`max_locks_per_transaction`; the default is deliberately conservative.

Any day that is not yet provisioned is not lost in the meantime: writes for it
land in the `DEFAULT` partition and the backfill (or the worker's normal
partition-provisioning window) drains them into a dated partition on a later
pass.

## 6. Verify TLS

Once DNS for both domains resolves to this host, Caddy obtains certificates
automatically on the first request. Check the API health endpoint and a short
link:

```bash
curl https://APP_DOMAIN/api/v1/health
curl -I https://SHORT_DOMAIN/<a-known-slug>
```

Substitute your real `APP_DOMAIN` and `SHORT_DOMAIN`. The first HTTPS request to
a domain can be slightly slow while Caddy performs the ACME challenge and issues
the certificate; subsequent requests are fast. If certificates do not issue,
the usual causes are DNS not yet resolving to this host or ports 80/443 not
being reachable from the internet.

## 7. Backup

`backup.sh` writes a timestamped, gzipped SQL dump. With no `DATABASE_URL` set
it reads `.env` and runs `pg_dump` inside the Postgres container:

```bash
bash backup.sh
```

The dump lands in `./backups/snapurl-YYYYmmdd-HHMMSS.sql.gz` by default (override
the directory with `BACKUP_DIR`). Postgres on a single volume is how people lose
data, so schedule this. A cron example (daily at 03:30):

```cron
30 3 * * * cd /opt/URL-Shortener-App/deploy/single-node && ./backup.sh >> backup.log 2>&1
```

The default (compose) path runs `pg_dump` inside the Postgres container, so the
client always matches the server. If instead you set `DATABASE_URL` to dump over
a connection string, use a `pg_dump` whose major version is at least the
server's (this project runs Postgres 18): `pg_dump` refuses to dump a server
newer than itself. Point `backup.sh` at a matching client with `PG_DUMP` (for
example `PG_DUMP="docker run --rm --network host postgres:18-alpine pg_dump"`)
when your host client is older.

## 8. Restore

`restore.sh` replays a dump produced by `backup.sh` with `psql`:

```bash
bash restore.sh backups/snapurl-YYYYmmdd-HHMMSS.sql.gz
```

With no `DATABASE_URL` set it reads `.env` and replays inside the Postgres
container. It replays on top of the existing database, so restore into a
fresh or empty database unless you are certain you want to merge. As with
backup, the `DATABASE_URL` path uses the host `psql`; override it with `PSQL`
if you need a version-matched client.

This restore path is not just documented, it is exercised in CI: the
`restore-test` job in [`.github/workflows/verify.yml`](./.github/workflows/verify.yml)
proves the backup and restore round-trip on every pull request.

## 9. Upgrade

To move to a new release:

1. Set `SNAPURL_TAG` in `.env` to the new release tag (for example `v2.0.0`), or
   leave it as `latest` to follow the newest published build.
2. Pull the new images and re-run migrations, then restart:

   ```bash
   docker compose pull
   docker compose --profile migrate up migrate
   docker compose up -d
   ```

Take a backup first (see [Backup](#7-backup)). Pin `SNAPURL_TAG` to a specific
release in production rather than tracking `latest`, so upgrades are deliberate.

## Profile 2: horizontally scaled (Kubernetes/Helm)

Everything above is Profile 1: one host, one Postgres, an in-process cache, and
Caddy for TLS. It is the right default for most self-hosters.

Profile 2 is the horizontally scaled deployment for when a single node is not
enough. It runs the **same GHCR images** as independent Kubernetes Deployments
with per-service replica counts, an autoscaler on the bursty redirect service, a
shared Redis-backed cache that keeps rate limiting correct across API replicas,
and migrations applied by a pre-upgrade Job rather than by the app pods at boot.

The trade-off is what you have to bring:

| | Profile 1 (single-node) | Profile 2 (Kubernetes/Helm) |
| --- | --- | --- |
| Runtime | `docker compose` on one host | A Kubernetes cluster (1.23+) |
| Postgres | Bundled in the compose stack | External managed Postgres 18 (you provide) |
| Cache | In-process (`CACHE_DRIVER=memory`) | External Redis (`CACHE_DRIVER=redis`, shared counter) |
| TLS | Caddy on the host | Ingress + cert-manager (or your LB) |
| Scaling | Single node | Independent replicas + HPA on redirect |
| Migrations | `migrate` compose profile | Pre-upgrade Helm hook Job |

Choose Profile 2 when you need to scale the API and the redirect hot path
independently behind a real ingress with external state. Otherwise stay on
Profile 1: it is simpler and cheaper.

The full operator walk-through, values reference, and install/upgrade commands
live in [`deploy/helm/README.md`](./deploy/helm/README.md).

## What is CI-verified vs. what needs a real domain

Being honest about this matters, so here is the split:

- **CI-verified.** The integration harness in
  [`.github/workflows/verify.yml`](./.github/workflows/verify.yml) exercises the
  same runtime container images this profile runs, via the compose integration
  harness, and the `restore-test` job proves the backup and restore round-trip
  on every pull request. By the epic's rule, running the integration harness
  against this profile in CI is what makes it supported rather than
  experimental.
- **Needs a real domain (cannot be CI-tested).** TLS/ACME certificate issuance
  and the Caddy reverse proxy on real domains cannot be tested in CI, because CI
  has no public DNS or domain pointing at it. The certificate issuance, the two
  domain routes, and the end-to-end HTTPS path must be validated by you, the
  operator, following [Verify TLS](#6-verify-tls) on your own domains.

## Profile characteristics

This profile is deliberately simple, with no Redis and no DynamoDB:

- **Postgres adapters throughout.** The redirect service reads link config
  straight from Postgres and writes clicks straight to Postgres. This is the
  redirect image's built-in behavior (it wires the Postgres resolver and click
  sink directly), not a runtime switch you flip, so there is nothing to
  configure here. Postgres is the single source of truth.
- **In-memory `CacheStore`** (`CACHE_DRIVER=memory`). The cache is in-process,
  so there is no external cache to run or scale.
- **In-process click batching.** Click rollups run in the long-running worker's
  in-process rollup loop on timers; there is no separate queue.
- **`TRUSTED_PROXY_HOPS=1`.** Caddy is the single reverse proxy in front of the
  app, appending `X-Forwarded-For`, so the real client IP is exactly one hop
  from the right of the chain.

## Retention

How long raw click rows are kept is an operator decision, set on the worker.
The rollups the dashboards read are kept regardless; only the raw per-click
detail expires. These knobs are read by the worker at boot, so set them in the
worker's environment (the `worker` service on the compose profile, the worker
Deployment env on Helm).

- **`CLICK_EVENTS_RETENTION_YEARS`** (default `3`). The install-wide retention
  window, in years. `click_events` is partitioned by day and a single day's
  partition is shared by *every* workspace, so there is one cutoff for the whole
  table and it is yours to set, not the tenants'. The default `3` matches the
  historical default and the per-workspace column default, so out of the box
  nothing changes. Raise it when your storage budget and compliance needs allow
  a longer window for the whole install.

  Per-workspace retention (the "Click data retention" setting in the app) is
  **subtractive**: a workspace may keep click data for *less* than this window,
  never more. A workspace asking for more than the install window is clamped
  down to it. Because a day's partition is only dropped once its whole range is
  past the cutoff, raw rows can survive up to a day beyond the configured
  window.

- **`CLICK_EVENTS_MAX_RETAINED_DAYS`** (default `1100`, roughly three years of
  daily partitions). An age-independent backstop on how many day-partitions stay
  attached, so total storage cannot silently grow past a hard ceiling regardless
  of the retention window. It is a no-op under normal operation (the default
  matches the default retention) and only bites when partition count runs ahead
  of the storage budget; tighten it if your storage is tighter than the default
  window assumes.
## Browser extension

The [SnapURL browser extension](./apps/extension/README.md) is a Manifest V3
Chrome extension that shortens the active tab against your self-hosted API. It
runs entirely in the browser and calls your API with `fetch`, so the API's CORS
must allow the extension's origin. Set `EXTENSION_ORIGINS` (a comma-separated
list, empty by default) to the extension's `chrome-extension://<id>` origin,
which you can read off the `chrome://extensions` card after loading it unpacked.
Leaving `EXTENSION_ORIGINS` empty keeps CORS locked to the dashboard origin
exactly as before. See [`apps/extension/README.md`](./apps/extension/README.md)
for building, loading and configuring the extension.
