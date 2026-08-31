# SnapURL 2.0 — architecture

The core is a stateless ports-and-adapters application. The deployment
**profile**, not the code, chooses which adapter runs behind each port: a link
resolver reads Postgres in one profile and DynamoDB in another, a click sink
writes Postgres in one and SQS in another, and the application logic above them
does not know or care which. Every profile runs the same compiled images; the
adapters are selected at deploy time by environment variables.

Companion documents: [DECISIONS.md](./DECISIONS.md) for every judgement call and
why, [DEPLOYMENT.md](./DEPLOYMENT.md) for how to ship each profile, and
[BACKEND.md](./BACKEND.md) for how to run it locally.

---

## Ports and their adapters

Each port is a narrow interface. The adapters listed below are the ones that
**actually exist in the tree today** — where a port has only one adapter, that
is stated plainly rather than dressed up as a choice.

| Port | Interface | Adapters that exist today |
| --- | --- | --- |
| `LinkResolver` | `apps/redirect/src/resolver.ts` | `PostgresLinkResolver` (default) and `DynamoLinkResolver` (AWS profile, `LINK_PROJECTION=dynamo`). Both are wrapped by `CachingLinkResolver` (`apps/redirect/src/caching-resolver.ts`), a short-lived cache in front of whichever inner resolver is chosen. |
| `ClickSink` | `apps/redirect/src/click-sink.ts` | `PostgresClickSink` (default — `INSERT` straight into `click_events`) and `SqsClickSink` (`CLICK_SINK=sqs` — an awaited SQS `SendMessage`, drained back into `click_events` by the worker). |
| `ProjectionTarget` | `apps/worker/src/jobs/outbox.ts` | `NoProjection` (default, a no-op) and `DynamoProjection` (`apps/worker/src/jobs/dynamo-projection.ts` — drains `projection_outbox` into the DynamoDB `LinkProjectionTable`, and also writes the CloudFront `KeyValueStore` for the edge fast path). |
| `AnalyticsReader` | `apps/api/src/analytics/analytics.reader.ts` | `PostgresAnalyticsReader` only. The seam is real and bound via DI (`ANALYTICS_READER` in `analytics.module.ts`), but a columnar adapter is future work — this port is genuinely still single-adapter today, and that is not hidden. |
| `CacheStore` | `packages/cache/src/cache-store.ts` | `MemoryCacheStore` (default), `RedisCacheStore`, `DynamoDbCacheStore`, selected by `CACHE_DRIVER` through `createCacheStore` in `packages/cache/src/factory.ts`. The redis and dynamodb branches `await import()` lazily, so a memory-only deployment never loads `ioredis` or the AWS SDK. |
| `SaltSource` | `apps/redirect/src/salt.ts` | `PostgresSaltCache` (the `daily_salts` table, used whenever the redirect holds a Postgres handle) and `CacheStoreSaltCache` (reads/writes the shared `CacheStore` — DynamoDB on the AWS profile — which is what lets the redirect leave Postgres entirely). |
| Mail seam | `apps/api/src/mail/mail.service.ts` | `MailService.send` with the `outbox` transport (writes each message under `os.tmpdir()/snapurl-outbox`). The `ses` branch logs "not wired yet" and is future work. |

The point of every one of these seams is that turning an AWS feature on is a
config change, not a rewrite. The two projection switches (`LINK_PROJECTION`,
`CLICK_SINK`) both default OFF, so every non-AWS profile runs the Postgres paths
byte-for-byte unchanged.

---

## The three deployment profiles

### Profile 1 — Single node (the reference implementation)

Postgres throughout. `CACHE_DRIVER` unset or `memory`, so the in-memory
`CacheStore`; in-process click batching; `LINK_PROJECTION` unset;
`CLICK_SINK=postgres`. Nothing to run alongside the app, no container to warm,
no extra dependency. This is what `docker compose --profile full` runs, and it
is **the only profile with a green smoke run in CI today** (both smoke suites
pass against the composed stack). It is the honest baseline the other two are
measured against.

### Profile 2 — Horizontally scaled / cloud-agnostic

Postgres primary plus an optional read replica (via `createDatabase`'s read URL,
so reads through `readDb` land on the replica while writes stay on the primary).
Redis for the `CacheStore`, rate-limit counters, queueing and sketch merging —
one container that runs anywhere. Optional columnar analytics *behind* the
`AnalyticsReader` port (the seam is there; the adapter is not yet). The Helm
chart lives in `deploy/helm`. This profile has no green CI smoke run yet, so by
the epic's honesty rule it is documented as **experimental**.

### Profile 3 — AWS-native serverless

Lambda for all three apps. The redirect reads a DynamoDB `LinkProjectionTable`
via `DynamoLinkResolver`; clicks go to an SQS `ClickQueue` drained by the
worker's `SqsEventSource` (event source mapping, `reportBatchItemFailures`); a
CloudFront Function plus `KeyValueStore` answer edge-eligible simple links at the
edge; a DynamoDB `CacheTable` backs the shared salt so a redirect that has left
the VPC still salts its visitor hashes without a Postgres connection; egress is
governed by `natStrategy`; and under `LINK_PROJECTION=dynamo` + `CLICK_SINK=sqs`
the redirect drops its `vpcSettings` and leaves the VPC entirely.

Following [DECISIONS.md](./DECISIONS.md)'s honesty framing, the adapters and the
CDK shape are **built and CI/synth-proven**, but **no real `cdk deploy`** has run
against a real account. So a real edge invocation, a real SQS round trip, and a
real no-VPC DynamoDB resolution are all **deploy-deferred**. This profile is
therefore **experimental** — it has no green CI smoke run. It is *not*
"404s-on-everything": that was the pre-#274 state, before the origin request
policy forwarded the viewer headers and the resolver/sink adapters landed, and
it is no longer true.

---

## Per-profile decisions the epic introduces

### The egress call — `natStrategy` (AWS profile only, #281)

Egress is a property of the AWS profile, wired from
`app.node.tryGetContext('natStrategy')` in `infra/bin/snapurl.ts`. Options:
`'instance'` (default, a t4g.nano NAT instance, ~$3/mo), `'gateway'` (managed
NAT, ~$32/mo), `'none'` ($0, the original zero-egress topology, where Safe
Browsing / webhooks / OAuth / mail are non-functional by design). NAT was chosen
over a free egress-only IPv6 IGW because arbitrary customer webhook receivers
cannot be relied on to publish `AAAA` records, so IPv6-only egress would leave
webhook coverage patchy. This decision applies to the AWS profile only; the
other two profiles run wherever their operator puts them. Full reasoning in
[DECISIONS.md](./DECISIONS.md).

### The click-accounting call for edge-served redirects (#289)

The edge fast path serves only links where per-click accuracy does not matter.
Any link with a click limit or an analytics commitment stays authoritative in
the Lambda, so the count that gates a limit is never decided by a request the
origin never saw. Only simple links — no limit, no per-click obligation — are
promoted to the CloudFront `KeyValueStore`. This keeps the click counter's
bounded overshoot (the Postgres `link_counters` value recomputed by the rollup
worker, read by both resolvers) the *only* source of imprecision, rather than
adding an untracked edge-served population on top of it. Cross-referenced in
[DECISIONS.md](./DECISIONS.md) (assumption 8 and the Profile 3 section).
