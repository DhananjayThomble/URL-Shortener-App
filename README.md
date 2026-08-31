# SnapURL

Short links, dynamic QR codes and cookieless analytics.

A pnpm workspace on Node 22: a NestJS dashboard API, a separate Fastify service
for the redirect hot path, a background worker, a Next.js dashboard, and four
shared packages that keep them agreeing with each other.

- **How to run it locally:** [docs/BACKEND.md](./docs/BACKEND.md)
- **How to self-host it on your own domain:** [SELF-HOSTING.md](./SELF-HOSTING.md)
- **Why it is built this way:** [docs/DECISIONS.md](./docs/DECISIONS.md)
- **How to contribute:** [CONTRIBUTING.md](./CONTRIBUTING.md)

---

## Layout

Eight workspace projects, listed in [`pnpm-workspace.yaml`](./pnpm-workspace.yaml).

| Path | What it is |
| --- | --- |
| `apps/api` | NestJS 11 on Fastify. 40 routes across 11 controllers — the whole dashboard surface. |
| `apps/redirect` | Plain Fastify, deliberately not NestJS. Resolves `(host, slug)` and redirects. Nothing else lives here, because everything here is on the hot path. |
| `apps/worker` | Rollups, the projection outbox and webhook delivery — `apps/worker/src/jobs/`. |
| `packages/contract` | zod schemas. The single source of truth for every payload; imported by both `apps/api` and `web/`. |
| `packages/domain` | Pure logic: routing-chain evaluation, slug generation, visitor hashing. No I/O, no framework. |
| `packages/database` | Drizzle schema (21 tables), migrations and seed. |
| `web` | Next.js 15 App Router, React 19, Tailwind v4, TanStack Query. |
| `apps/extension` | Manifest V3 Chrome extension. Shortens the active tab against your own API. See [`apps/extension/README.md`](./apps/extension/README.md). |

The two rules that hold it together: the contract package is the only place a
payload shape is defined, and `packages/domain` is imported by both the API that
validates a routing chain and the redirect service that executes it — so there
is exactly one implementation of where a visitor lands.

## Quick start

```bash
pnpm install
pnpm build
pnpm test
```

That is enough to build and test everything; none of it needs a database.

Running the apps does need one. Postgres **18** specifically — the schema calls
`uuidv7()`, which is native in 18 and does not exist in 17 — on port **5433**,
which is what [`docker-compose.yml`](./docker-compose.yml) provides:

```bash
pnpm db:up          # Postgres 18 on :5433
pnpm db:migrate
pnpm db:seed
pnpm dev            # all three apps
pnpm dev:web        # the dashboard, separately
```

[docs/BACKEND.md](./docs/BACKEND.md) has the full sequence, the ports, and the
seeded login.

### The frontend runs without a backend

`NEXT_PUBLIC_USE_FIXTURES` is opt-in and defaults to **off**
([`web/src/lib/api/client.ts`](./web/src/lib/api/client.ts)), so `pnpm dev:web`
talks to the real API. Set it to `"true"` in `web/.env.local` to serve the whole
dashboard from `web/src/lib/api/fixtures.ts` with no API and no database
running — useful for frontend-only work.

Worth knowing before you add a hook: while fixtures are on, a hook without a
matching fixture will appear to work and be entirely fake. That is why the
default is off, and why a production build with fixtures enabled fails outright
rather than shipping invented data.

## Checks

These four are what CI runs, in this order
([`.github/workflows/verify.yml`](./.github/workflows/verify.yml)):

```bash
pnpm install --frozen-lockfile
pnpm type-check     # builds packages first, then checks all 7 projects
pnpm build
pnpm test
```

CI then applies the migrations to an empty Postgres 18, starts the API and the
redirect service, and runs `scripts/smoke.sh` and `scripts/smoke-redirect.sh`
against them.

Some tests need a database and skip without one. They run in CI, which sets
`DATABASE_URL`; locally they run after `pnpm db:up && pnpm db:migrate`.

> **`pnpm lint` does not work.** `web/package.json` declares `eslint .` with no
> eslint config and no eslint dependency. Fixing it means adding both and
> producing a repo-wide diff, so it is left alone deliberately rather than
> half-done.

## Requirements

| | |
| --- | --- |
| Node | 22+ (`engines` in [`package.json`](./package.json)) |
| pnpm | 11.24.0 (`packageManager`, so corepack picks it up) |
| Postgres | 18, on 5433 — not 17, and not the default port |
| Docker | only for the database |

## License

[MIT](./LICENSE).
