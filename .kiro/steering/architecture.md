# SnapURL — Architecture rules (steering)

These rules bind every agent turn and every subagent. They encode decisions
already made in `docs/DECISIONS.md`; violating them is a bug, not a style choice.

## Monorepo shape
- pnpm workspace. Projects: `apps/{api,redirect,worker,extension}`, `web`,
  `packages/{contract,domain,database,cache}`. Do not add a top-level project
  without an ADR.
- **`packages/contract` is the single source of truth for all request/response
  payloads (zod).** API and web both import from it. Never redefine a payload
  shape inline in a controller or a React component — import the zod schema.
- **`packages/domain` is pure shared logic** (routing chains, geo/device rules).
  It must not import from `apps/*` or from `packages/database`. Keep it
  side-effect-free and framework-agnostic.
- No cross-`apps` imports. `apps/api`, `apps/redirect`, `apps/worker` share code
  only through `packages/*`, never by reaching into each other.

## The redirect hot path is sacred
- `apps/redirect` is latency-critical and deliberately has **no rate limiting**
  and minimal dependencies. Do not add heavyweight middleware, ORM calls on the
  request path, or synchronous external calls to it. Click accounting is done
  via the outbox/worker, not inline.
- Rate limiting (`@nestjs/throttler`, default 120/min) belongs on the dashboard
  API only.

## Database
- Postgres 18, Drizzle ORM, schema in `packages/database`. Every schema change
  is a Drizzle migration — never hand-edit a live table shape.
- Uses native `uuidv7()`. New primary keys follow the same pattern unless an ADR
  says otherwise.
- Anything that touches the DB is tested against a **real Postgres via
  Testcontainers**, not a mock.

## Architectural changes require an ADR
- A new external dependency, a new service, a change to the contract/domain
  boundary, or a change to a deploy profile: add an entry to `docs/DECISIONS.md`
  (with a "revisit if" clause) in the same PR. No silent architecture drift.

## Deploy profiles
- Three profiles exist: AWS-serverless (CDK), single-node (docker compose), and
  Helm. **Single-node `docker compose up` is the flagship self-host story and
  must keep working** — do not introduce a hard dependency on an external SaaS
  (Tinybird/PlanetScale/Upstash-style) on the single-node path. Swappable ports
  (e.g. `CacheStore`) are the mechanism; use them.
