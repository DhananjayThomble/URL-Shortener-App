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

## 8. Restore

`restore.sh` replays a dump produced by `backup.sh` with `psql`:

```bash
bash restore.sh backups/snapurl-YYYYmmdd-HHMMSS.sql.gz
```

With no `DATABASE_URL` set it reads `.env` and replays inside the Postgres
container. It replays on top of the existing database, so restore into a
fresh or empty database unless you are certain you want to merge.

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
