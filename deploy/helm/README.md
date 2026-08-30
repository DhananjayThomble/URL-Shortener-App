# SnapURL Profile 2: the horizontally scaled Kubernetes deployment

This is the operator walk-through for running SnapURL on Kubernetes with the
Helm chart under [`snapurl/`](./snapurl). It is Profile 2 from the architecture
epic: the three server images run as independent Deployments with per-service
replica counts, an autoscaler on the bursty redirect service, a shared
Redis-backed cache so rate limiting stays correct across API replicas, and
migrations applied by a pre-upgrade Job rather than by the app pods at boot.

One chart covers EKS, GKE, AKS, k3s and bare-metal Kubernetes. There is no
per-cloud IaC module to maintain.

## Profile 1 or Profile 2?

Pick the profile that matches how much you need to scale, not the biggest one.

- **Profile 1 (single-node, compose + Caddy).** One host, one Postgres, an
  in-process cache, in-process click batching, and Caddy for TLS. This is the
  right default: it is simpler, cheaper, and it is the profile most self-hosters
  want. See [`../../SELF-HOSTING.md`](../../SELF-HOSTING.md).
- **Profile 2 (this chart).** Choose it when a single node is not enough: you
  need to scale the API and the redirect hot path independently, run multiple
  replicas behind a real ingress, and let an external Postgres and Redis carry
  the state. It expects you to bring your own managed Postgres and Redis and a
  Kubernetes cluster to run on.

The two profiles run the **same GHCR images**. The difference is topology, not
code.

## Prerequisites

Profile 2 does not ship a database or a cache. Both are external and required
before the chart will deploy:

- A **Kubernetes cluster, version 1.23 or newer**. The chart uses
  `autoscaling/v2` (HPA), `policy/v1` (PodDisruptionBudget) and
  `networking.k8s.io/v1` (Ingress), all GA from 1.23. This is the floor declared
  in [`snapurl/Chart.yaml`](./snapurl/Chart.yaml) (`kubeVersion: ">=1.23.0-0"`).
- **Helm 3**.
- An **external managed Postgres 18 primary** reachable from the cluster (RDS,
  Cloud SQL, Neon, and so on). Postgres 18 is required because the schema uses
  `uuidv7()`, which is native in 18. Optionally a read replica for
  `postgres.replicaUrl`.
- An **external Redis** reachable from the cluster. Redis is what makes
  multi-replica rate limiting correct (see
  [Why Redis is required](#why-redis-is-required-multi-replica-rate-limiting)).

The chart ships no Postgres and no Redis on purpose. If you want an in-cluster
Postgres for testing, add a subchart such as `bitnami/postgresql` yourself and
point `postgres.url` at its Service DNS. Production should use a managed primary
with backups you did not have to build.

## Install

Provide the three things the chart cannot default: the Postgres URL, the Redis
URL, and the two JWT signing secrets (or an existing Secret that holds them).
This is a `helm install` (expressed as `helm upgrade --install`, which is
idempotent and works for both the first install and later upgrades):

```bash
helm upgrade --install snapurl deploy/helm/snapurl \
  --namespace snapurl --create-namespace \
  --set-string postgres.url="postgres://user:pass@db-host:5432/snapurl" \
  --set-string redis.url="redis://redis-host:6379" \
  --set secrets.jwtAccessSecret="REPLACE_WITH_A_32_PLUS_CHAR_SECRET" \
  --set secrets.jwtRefreshSecret="REPLACE_WITH_A_DIFFERENT_32_PLUS_CHAR_SECRET" \
  --set ingress.enabled=true \
  --set-string ingress.className=nginx \
  --set-string ingress.apiHost=app.example.com \
  --set-string ingress.redirectHost=s.example.com \
  --set ingress.tls.enabled=true \
  --set-string ingress.tls.clusterIssuer=letsencrypt-prod
```

The hostnames and secrets above are placeholders. Use your own, and never commit
real secret values into a values file. For production, prefer
`secrets.existingSecret` over inline secrets (see [Secrets](#secrets)).

`helm upgrade --install` runs the migrate Job as a pre-install hook and waits
for it before the app pods roll. When the release completes the chart prints
post-install notes (`snapurl/templates/NOTES.txt`) with the workload counts, how
to reach the services, and a reminder about `TRUSTED_PROXY_HOPS`.

If you leave `ingress.enabled=false`, reach the services with `kubectl
port-forward` (the notes print the exact commands).

## Values reference

Every key below exists in [`snapurl/values.yaml`](./snapurl/values.yaml), which
is heavily commented and is the authoritative contract. This table summarizes
the top-level stanzas.

### Images

| Key | Default | Notes |
| --- | --- | --- |
| `image.registry` | `ghcr.io` | Registry for all three images. |
| `image.repositoryPrefix` | `dhananjaythomble/snapurl-` | Composed as `registry/prefix<component>:tag`. |
| `image.tag` | `latest` | Pin to a release (e.g. `v2.0.0`) in production. |
| `image.pullPolicy` | `IfNotPresent` | |
| `imagePullSecrets` | `[]` | Only needed for a private registry. |

### api

The NestJS control plane (auth, links CRUD, analytics reads). This is where
rate limiting is enforced.

| Key | Default | Notes |
| --- | --- | --- |
| `api.replicaCount` | `2` | Scales independently; safe to raise once Redis is set. |
| `api.image.repository` / `api.image.tag` | `""` | Per-service overrides; blank uses the global image. |
| `api.resources.requests` / `api.resources.limits` | `250m`/`256Mi` req | Sensible starting requests and limits. |
| `api.probes` | `initialDelaySeconds: 10`, etc. | Probe path is fixed at `/api/v1/health` on port 3001. |
| `api.service.port` | `3001` | |

### redirect

The Fastify hot path (three routes). The only bursty deployment, so it is the
only one with an HPA.

| Key | Default | Notes |
| --- | --- | --- |
| `redirect.replicaCount` | `3` | Seed only when `hpa.enabled` (the HPA then owns the count). |
| `redirect.image.repository` / `redirect.image.tag` | `""` | Per-service overrides. |
| `redirect.resources.requests` / `redirect.resources.limits` | `100m`/`128Mi` req | |
| `redirect.probes` | `initialDelaySeconds: 10`, etc. | Probe path is fixed at `/health` on port 3002. |
| `redirect.service.port` | `3002` | |

### worker

The in-process rollup/maintenance loop. No HTTP surface, no Service, no probes,
no PDB.

| Key | Default | Notes |
| --- | --- | --- |
| `worker.replicaCount` | `1` | Keep small and fixed (see [Scaling](#scaling)). |
| `worker.image.repository` / `worker.image.tag` | `""` | Per-service overrides. |
| `worker.resources.requests` / `worker.resources.limits` | `100m`/`128Mi` req | |

### ingress

Routes the two public hostnames to the api and redirect Services.

| Key | Default | Notes |
| --- | --- | --- |
| `ingress.enabled` | `false` | When off, use `kubectl port-forward`. |
| `ingress.className` | `""` | e.g. `nginx`, `traefik`; empty uses the cluster default. |
| `ingress.annotations` | `{}` | Extra annotations (cert-manager is merged in from `tls`). |
| `ingress.apiHost` | `""` | Dashboard/API hostname to the api Service. |
| `ingress.redirectHost` | `""` | Short-link hostname to the redirect Service. |
| `ingress.tls.enabled` | `false` | |
| `ingress.tls.secretName` | `""` | A single TLS Secret covering both hosts. |
| `ingress.tls.clusterIssuer` | `""` | cert-manager ClusterIssuer; adds the `cluster-issuer` annotation. |

### postgres (external)

| Key | Default | Notes |
| --- | --- | --- |
| `postgres.url` | `""` (required) | `postgres://USER:PASSWORD@HOST:5432/DBNAME`; goes to the Secret. |
| `postgres.replicaUrl` | `""` | Optional read-replica string; absent means reads use the primary. |
| `postgres.ssl` | `false` | Enable TLS to the database. |
| `postgres.sslNoVerify` | `false` | Skip cert checks (VPC/self-signed only; insecure otherwise). |
| `postgres.caCert` | `""` | PEM CA bundle to verify the server cert; goes to the Secret. |
| `postgres.poolMax` | `10` | Max pool connections per pod. |

### redis (external)

| Key | Default | Notes |
| --- | --- | --- |
| `redis.url` | `""` | `redis://[:PASSWORD@]HOST:6379`. When set, forces `CACHE_DRIVER=redis` for every service. |

### throttle

| Key | Default | Notes |
| --- | --- | --- |
| `throttle.ttlSeconds` | `60` | Global throttle window (`THROTTLE_TTL_SECONDS`). |
| `throttle.limit` | `120` | Requests per window (`THROTTLE_LIMIT`). |

### App env (non-secret)

| Key | Default | Notes |
| --- | --- | --- |
| `webOrigin` | `""` | Dashboard origin (CORS + email links). |
| `defaultDomain` | `""` | Default short domain for new workspaces. |
| `redirectOrigin` | `""` | Where redirects are served from (for building short URLs). |
| `trustedProxyHops` | `1` | Proxy hop count that appends `X-Forwarded-For` (see [below](#trusted_proxy_hops-and-your-ingress)). |
| `mail.transport` | `outbox` | `outbox` writes messages to a file; `ses` uses SES. |
| `mail.from` | `""` | e.g. `SnapURL <no-reply@example.com>`. |
| `logLevel` | `info` | `trace`, `debug`, `info`, `warn`, `error`. |

### secrets

| Key | Default | Notes |
| --- | --- | --- |
| `secrets.jwtAccessSecret` | `""` | Inline JWT access secret (>=32 chars). |
| `secrets.jwtRefreshSecret` | `""` | Inline JWT refresh secret (>=32 chars; must differ). |
| `secrets.existingSecret` | `""` | Name of a Secret you manage instead (see [Secrets](#secrets)). |

### hpa (redirect only)

| Key | Default | Notes |
| --- | --- | --- |
| `hpa.enabled` | `true` | Autoscales the redirect Deployment only. |
| `hpa.minReplicas` | `3` | |
| `hpa.maxReplicas` | `10` | |
| `hpa.targetCPUUtilizationPercentage` | `70` | `autoscaling/v2` CPU target. |

### pdb (api and redirect only)

| Key | Default | Notes |
| --- | --- | --- |
| `pdb.enabled` | `true` | No PDB for the single-replica worker. |
| `pdb.api.minAvailable` | `1` | |
| `pdb.redirect.minAvailable` | `1` | |

### analytics

| Key | Default | Notes |
| --- | --- | --- |
| `analytics.reader` | `postgres` | The only reader that exists today. |
| `analytics.columnar.enabled` | `false` | Future seam; wires env only (see [below](#the-analyticsreader-columnar-seam-future)). |
| `analytics.columnar.driver` | `""` | Future, e.g. `clickhouse`. |
| `analytics.columnar.url` | `""` | Future columnar store connection string. |

### migrateJob

| Key | Default | Notes |
| --- | --- | --- |
| `migrateJob.enabled` | `true` | Set `false` if migrations are managed out of band (see [Upgrades](#upgrades-and-migrations)). |
| `migrateJob.backoffLimit` | `3` | |
| `migrateJob.activeDeadlineSeconds` | `600` | |

### Other

`serviceAccount`, `podSecurityContext`, `securityContext`, `nodeSelector`,
`tolerations`, and `affinity` follow the usual chart conventions; see
`snapurl/values.yaml` for their defaults. The security contexts match the
Dockerfile's non-root `node` user (uid 1000).

## Scaling

The three services scale independently because their load profiles differ
sharply.

- **api** runs a fixed `api.replicaCount` (default 2). It is not autoscaled by
  the chart. Raise it as your control-plane traffic grows. This is safe only
  because Redis makes the rate-limit counter shared across pods; see below.
- **redirect** is the only bursty deployment (a short link can go viral), so it
  is the only one with an **HPA** (`autoscaling/v2`, CPU target). When
  `hpa.enabled` is true the **HPA owns redirect's replica count** between
  `hpa.minReplicas` and `hpa.maxReplicas`, so `redirect.replicaCount` is only
  the initial seed. Set `hpa.enabled=false` to pin the count with
  `redirect.replicaCount` instead (for example on a cluster with no
  metrics-server, where an HPA would sit with unknown metrics).
- **worker** stays at a **small fixed count** (default 1). Its rollup loop
  drains `click_events` then marks them consumed on the primary handle; running
  many concurrent workers would just have them contend on the same rows for no
  throughput gain. It is deliberately not autoscaled and has no Service, no
  probes, and no PDB.

`PodDisruptionBudget`s guard api and redirect (`minAvailable: 1` each) so at
least one pod stays up during a voluntary node drain while still letting the
drain proceed. There is no PDB on the worker: a `minAvailable` on a one-replica
Deployment would block node drains entirely.

## Why Redis is required (multi-replica rate limiting)

Rate limiting is enforced by the **API**, not the redirect service. The API
backs `@nestjs/throttler` with the `CacheStore`. When `redis.url` is set the
chart forces `CACHE_DRIVER=redis` for every service, so the throttler's counter
lives in Redis and is **shared across all API replicas**. The effective limit is
then the configured limit, not the limit multiplied by the number of pods.

This is the correctness property Profile 2 exists to guarantee (issue #285).
Without Redis, `CACHE_DRIVER` falls back to the per-instance `memory` driver,
which is only correct for a single API replica: with N replicas each pod keeps
its own counter and the effective limit becomes `limit x N`.

**Set `redis.url` for any multi-replica deployment.** The redirect service uses
the cache only for hot-link caching (a short TTL), not for throttling, so it is
scaling the API that depends on the shared counter.

The kind CI job ([`.github/workflows/deploy-helm.yml`](../../.github/workflows/deploy-helm.yml))
proves this end to end: it deploys the chart with `CACHE_DRIVER=redis`, scales
the API to 3 replicas, sends more requests than the limit at a throttled
endpoint, and asserts that a 429 appears and that no more than `limit` requests
get through. On the per-pod memory driver that assertion would fail, so the test
genuinely proves the shared Redis counter.

## Upgrades and migrations

The app pods **never migrate at boot**. Migrations run in a dedicated Job that
the chart registers as a `helm.sh/hook: pre-install,pre-upgrade` hook. Helm runs
that hook and waits for it to complete **before** the new app pods roll. The Job
reuses the worker image and calls the same `runMigrations` entry point the
single-node compose migrate service uses.

Running migrations out of the boot path is deliberate: if every app pod tried to
migrate as it started, concurrent boots would race on the schema. The
pre-upgrade Job applies pending migrations exactly once, then the rollout
proceeds.

To upgrade, point `image.tag` at the new release and run the same command:

```bash
helm upgrade --install snapurl deploy/helm/snapurl \
  --namespace snapurl \
  --set-string image.tag=v2.0.0 \
  --reuse-values
```

Take a database backup first, and pin `image.tag` to a specific release rather
than tracking `latest` so upgrades are deliberate.

If you manage migrations out of band (for example a separate CD step or a DBA
process), set `migrateJob.enabled=false` and the chart will not create the hook.

## TRUSTED_PROXY_HOPS and your ingress

`trustedProxyHops` (env `TRUSTED_PROXY_HOPS`, default `1`) is the number of
proxies in front of the services that **append** their edge IP to
`X-Forwarded-For`. The throttler and the visitor hash derive the real client IP
as the `(trustedProxyHops + 1)`th entry from the right of the chain, so a client
cannot forge it.

This value **must match your actual ingress topology**, or client-IP-derived
rate limiting and visitor hashing key off the wrong IP:

- **nginx-ingress alone in front of the services:** `1` (the default).
- **nginx-ingress behind a cloud load balancer that also appends XFF:** `2`.

Add 1 for each additional appending hop. If you are unsure whether your cloud LB
appends to `X-Forwarded-For`, check its documentation before changing this.

## The AnalyticsReader columnar seam (future)

Only the **Postgres** `AnalyticsReader` exists in code today (issue #284). The
`analytics.columnar` stanza is a documented **future** plumbing seam: it is
`enabled: false` by default, and when enabled it wires environment only. **No
columnar adapter ships with this chart.** Leave `analytics.columnar.enabled`
false unless and until a columnar reader exists. The seam is here so the env
contract is ready when that adapter lands; see
[`../../docs/DECISIONS.md`](../../docs/DECISIONS.md) for the analytics-store
rationale.

## Secrets

The chart needs the two JWT signing secrets, plus the credential-bearing
connection strings. You have two options:

1. **Inline** `secrets.jwtAccessSecret` and `secrets.jwtRefreshSecret`. Each
   must be at least 32 characters, and the two must differ. The chart then
   creates a Secret that also holds `database-url`, `redis-url`, and (if set)
   `database-ca-cert`. Do not commit real inline secrets to a values file.
2. **`secrets.existingSecret`** (preferred for production). Set it to the name
   of a Secret you manage, for example via an external secrets operator. The
   chart then creates no Secret of its own and expects these keys in yours:

   - `jwt-access-secret`
   - `jwt-refresh-secret`
   - `database-url`
   - `redis-url`
   - `database-replica-url` (optional)
   - `database-ca-cert` (optional)

The render fails if you provide neither inline secrets nor an existing Secret,
so you cannot accidentally deploy with no secret.
