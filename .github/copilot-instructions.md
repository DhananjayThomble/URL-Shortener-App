# Working in this repository

SnapURL is a pnpm workspace on Node 22. Seven projects: three backend apps, three
shared packages, one Next.js frontend.

Read [docs/DECISIONS.md](../docs/DECISIONS.md) before proposing an architectural
change. It records what was chosen, what it was chosen over, and what would
justify revisiting it — including twelve assumptions made without the maintainer
present. If your change contradicts one, say so rather than quietly reversing it.

## Orientation

| Path | What it is | Notes |
| --- | --- | --- |
| `apps/api` | NestJS 11 + Fastify | 40 routes, 11 controllers |
| `apps/redirect` | Plain Fastify | The hot path. Not NestJS, on purpose |
| `apps/worker` | Rollups, outbox, webhooks | `src/jobs/` |
| `packages/contract` | zod schemas | **The only place a payload shape is defined** |
| `packages/domain` | Pure logic | Routing, slugs, visitor hashing. No I/O |
| `packages/database` | Drizzle + migrations | 21 tables |
| `web` | Next.js 15, React 19, Tailwind v4 | TanStack Query |

## The things that will waste your time

**Postgres 18, not 17.** The schema calls `uuidv7()`, which is native in 18 and
does not exist in 17. `docker-compose.yml` pins the version and maps it to port
**5433**, not 5432.

**`USE_FIXTURES` defaults to ON.** `web/src/lib/api/client.ts` routes every
frontend call to `web/src/lib/api/fixtures.ts` unless
`NEXT_PUBLIC_USE_FIXTURES` is explicitly `"false"`. **A hook added without a
matching fixture will appear to work and be entirely fake.** If you add a
mutation, add its fixture in the same change.

**`pnpm lint` fails.** `web/package.json` declares `eslint .` with no eslint
config and no eslint dependency. Do not run it and do not fix it in passing —
installing eslint and adding a config produces a repo-wide diff that buries
whatever you were actually doing.

**Some tests need a database.** They skip when `DATABASE_URL` is unset and run in
CI, which sets it and applies migrations before `pnpm test`. If you are changing
SQL, CI is the only thing that will actually verify it.

## Before you push

```bash
pnpm install --frozen-lockfile
pnpm type-check
pnpm build
pnpm test
```

All four must pass. `--frozen-lockfile` is what catches a dependency added
without committing the lockfile, which is why CI runs it that way.

## Conventions

**Change a payload in `packages/contract`, never in a copy.** Both `apps/api`
and `web/` import the same objects, so `tsc` points at every call site that needs
updating. `web/src/lib/api/types.ts` used to be a hand-copy of these schemas and
had silently drifted from the API by five fields and eleven input schemas; it is
now a re-export, and it should stay one.

**Raw `sql` fragments do not apply a column's type mapper.** Interpolating a
`Date` into one hands the driver a value it cannot serialise, and the query
throws before it reaches Postgres. Bind an ISO string with an explicit
`::timestamptz` cast, or use Drizzle's typed operators, which do apply the
mapper.

**Never skip, weaken or delete an assertion to get green.** Not in
`scripts/smoke.sh`, not in a `*.test.ts`. If an existing assertion starts
failing, that is the finding — report it. A red build with a good explanation is
worth more than a green one that got there by deleting a check.

**Commit messages explain why.** The diff already says what.

## API surface

Controllers are the routing table; there is no generated spec to consult:

```
apps/api/src/*/*.controller.ts
```

`apps/api/src/common/zod.pipe.ts` validates every body and query against the
contract schema named in the decorator, so a request shape is enforced in one
place rather than per-handler.

## Testing

Unit tests sit beside what they test (`*.test.ts`). `scripts/smoke.sh` exercises
the dashboard API end to end against a running server, and
`scripts/smoke-redirect.sh` does the same for the redirect path; CI runs both
after starting the two services.

## What is not here

There is **no v1**. The Express + Mongoose backend, the Vite frontend and the
Chrome extension were deleted, along with `backend/swagger.yml`. If you find a
reference to any of them, it is stale — report it rather than following it.

There is no SSO, no billing, no password reset and no email verification. The
only mail the system sends is a team invitation
(`apps/api/src/mail/mail.service.ts`), written to `logs/outbox/` by default.
