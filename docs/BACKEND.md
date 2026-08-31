# SnapURL 2.0 — backend

Three deployable apps and four shared packages, in one pnpm workspace with the
frontend that was already here.

Every judgement call, and why: [DECISIONS.md](./DECISIONS.md).

## Running it

Needs Node 22+, pnpm, and Docker.

```bash
pnpm install
pnpm db:up          # Postgres 18 on :5433 (5432 was taken)
pnpm db:migrate
pnpm db:seed        # demo@snapurl.local / demo-password-1234
pnpm build
```

Then three terminals, or `pnpm dev` for all of them:

```bash
pnpm dev:api        # :3001  dashboard API
pnpm dev:redirect   # :3002  the hot path
pnpm dev:worker     #        rollups, outbox, retention
pnpm dev:web        # :3000  the dashboard
```

`pnpm db:reset` wipes and rebuilds from scratch.

The frontend talks to the real API by default. To work on it without a backend
running, set `NEXT_PUBLIC_USE_FIXTURES=true` in `web/.env.local`. That is the
only change needed either way — the fixture adapter and the real client share
one call signature, which is what made an endpoint-at-a-time cutover possible.

## What is where

```
apps/
  api/        NestJS 11 + Fastify. Every endpoint the contract describes.
  redirect/   Plain Fastify. Deliberately not NestJS — see below.
  worker/     Rollups, the projection outbox, retention, webhook delivery.
packages/
  contract/   The zod schemas. Imported by web/ AND apps/api.
  domain/     Pure logic: routing chain, slug generation, visitor hashing.
  database/   Drizzle schema, migrations, seed, v1 import.
```

### Why the redirect app is not NestJS

It carries the least of any app here on purpose. The redirect is ~99.9% of the
traffic and has the tightest latency budget, so it does not get a DI container,
decorators, or `reflect-metadata` — none of which would earn their cold-start
cost on a service with three routes.

What it does share is `@snapurl/domain`, so the routing chain that decides where
a real person lands has exactly one implementation, imported by the app that
executes it and the app that validates it on save.

## Checks

```bash
pnpm type-check
pnpm test
bash scripts/smoke.sh           # 47 assertions against a running API
bash scripts/smoke-redirect.sh  # 21 assertions against API + redirect
```

The smoke scripts are end-to-end against real HTTP and a real database. They
cover the happy path, every contract gap that was closed, and three regressions
found during the build (a duplicate slug returning 500, a domain reporting zero
links, the shared domain being deletable).

## The two things to know before deploying

**Safe Browsing is off without a key.** With no `GOOGLE_SAFE_BROWSING_API_KEY`,
links are marked `clean` without being scanned, while the UI says "Scanned &
safe" and "Checked against Google Safe Browsing". The API logs a warning at boot
and on first use. Either set the key or change the copy — right now the product
makes a claim it is not backing up.

**Email is stubbed.** With `MAIL_TRANSPORT=outbox` (the default) invitations are
written to a file under `os.tmpdir()/snapurl-outbox` (overridable via
`MAIL_OUTBOX_DIR`) instead of sending. SES needs a verified domain and a
sandbox-exit request and remains unwired. `MailService.send` is the seam; wiring
SES is one adapter.

## Environment

Each app has a `.env.example`. The API validates its whole environment at boot
and refuses to start on anything invalid — a missing JWT secret should stop the
process, not surface as a confusing 401 three hours later.

The one value that must match across apps is `JWT_ACCESS_SECRET`: the redirect
service verifies unlock tokens that the API signed.

## Frontend follow-ups

The backend is written so the current frontend works unmodified. These unlock
the rest — the full table is in [DECISIONS.md](./DECISIONS.md) Part 4.

| Change | Why | Blocking |
| --- | --- | --- |
| Call `POST /auth/logout` in `useLogout` | Refresh tokens currently survive sign-out | **Yes — security** |
| Add `useUpdateLink` → `PATCH /links/:id` | Editing a destination is the core product promise | Yes |
| Handle `{ challenge: "totp" }` on login | 2FA users cannot sign in otherwise | Only with 2FA on |
| Unlock form on `/p/[slug]` | Password links are otherwise unreachable | Only for locked links |

## Deploying

`infra/` is a CDK v2 stack — the AWS serverless profile. The apps themselves
stay cloud-agnostic: they read all config from the environment and the ports are
conventional, so the single-node and Kubernetes profiles run on anything that
runs Node 22. See [DEPLOYMENT.md](./DEPLOYMENT.md) for how to ship, and
[ARCHITECTURE.md](./ARCHITECTURE.md) for the ports and the three profiles.

When you do deploy: the short version is that Lambda, DynamoDB, CloudFront and
SQS all sit inside AWS's always-free tiers at this scale, and **Postgres is
roughly 92% of the bill**. Run it on a free-tier Postgres elsewhere and the $100
credit outlives the project; run it on RDS and, at ~$15.50/month (Postgres plus
the default ~$3/mo NAT instance), the $100 lasts about **6.5 months** (100 /
15.5 ≈ 6.5) — not the 12 months the credits are *valid* for.
