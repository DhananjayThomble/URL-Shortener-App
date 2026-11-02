# SnapURL

[![Verify](https://github.com/DhananjayThomble/URL-Shortener-App/actions/workflows/verify.yml/badge.svg)](https://github.com/DhananjayThomble/URL-Shortener-App/actions/workflows/verify.yml)
[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](./LICENSE)
[![Latest release](https://img.shields.io/github/v/release/DhananjayThomble/URL-Shortener-App?sort=semver)](https://github.com/DhananjayThomble/URL-Shortener-App/releases)

**Short links, dynamic QR codes and cookieless analytics — self-hostable, no tracking cookies, no vendor lock-in.**

SnapURL turns a long URL into a branded short link, routes it by country, device
or language, and tells you how it performed — without setting a tracking cookie
or storing a visitor's IP. It is MIT licensed and runs on your own machine with
one Docker Compose stack, or on the free hosted instance.

- **Live demo:** [app.snapurl.in](https://app.snapurl.in/) — sign up with an email and start shortening.
- **Self-host it on your own domain:** [SELF-HOSTING.md](./SELF-HOSTING.md) (clean-machine tested).
- **Run it locally for development:** [docs/BACKEND.md](./docs/BACKEND.md).
- **Why it is built this way:** [docs/DECISIONS.md](./docs/DECISIONS.md) and [docs/ARCHITECTURE.md](./docs/ARCHITECTURE.md).
- **How to contribute:** [CONTRIBUTING.md](./CONTRIBUTING.md).

---

## What it does

- **Branded short links** on your own custom domains, with custom slugs
  (back-halves), link expiry and expiry fallbacks, password protection, tags,
  folders and UTM metadata.
- **Smart routing** — send one link to different destinations by country, device
  or language, plus weighted A/B routing. One implementation of routing is
  shared by the API that validates a chain and the redirect service that runs
  it (`packages/domain`), so there is exactly one place a visitor's landing is
  decided.
- **Dynamic QR codes** with SVG and PNG export, foreground colour, error-correction
  level and an optional centre logo. The QR points at the link, so you can change
  where it goes without reprinting the code.
- **Cookieless analytics** — unique visitors, clicks, QR scans, and breakdowns by
  country, device, browser, OS and referrer. No tracking cookie is set and no IP
  is stored; geography is read from the CDN edge header. Conversion events,
  funnels and revenue attribution are built in (`POST /conversions` + webhooks).
- **Bio pages (link-in-bio)** with header, link, embed, email and social blocks.
- **Teams** with roles and invitations, **API keys** with scoped access, and
  **webhooks** for click and conversion events.
- **A Manifest V3 Chrome extension** that shortens the active tab against your own
  API ([`apps/extension`](./apps/extension/README.md)).

## How it compares

A URL shortener is a crowded market. Where SnapURL differs is that it is open
source and self-hostable: the same code runs on the free hosted instance and on
your own hardware, with no feature held behind a plan tier and no per-link or
per-click meter.

The table below compares the **entry paid tier** and a few headline limits of
the three best-known hosted shorteners against self-hosting SnapURL. Every
competitor figure is quoted from the vendor's own pricing page, **accessed
2026-11-02**; prices are shown at each vendor's default billing toggle (noted
per cell) and are in USD. Vendors change pricing often — follow the source link
for the current numbers, and where a figure could not be confirmed on the
vendor's page the cell says **see vendor** rather than guess.

| | **SnapURL (self-hosted)** | **Bitly** | **Rebrandly** | **Short.io** |
| --- | --- | --- | --- | --- |
| Pricing model | MIT, free — you run it | Freemium, per-plan | Freemium, per-plan | Freemium, per-plan |
| Free tier | Not applicable (all features, self-run) | $0: 5 links/mo, 2 QR/mo [¹] | $0: 10 links/mo, 10 QR/mo, 1 custom domain [²] | $0: 1,000 branded links total, 5 domains, 50,000 tracked clicks/mo [³] |
| Entry paid tier | — | Core **$10/mo** billed annually ($120/yr) [¹] | Essentials **$16/mo** monthly ($11/mo annual) [²] | Hobby **$3/mo** at annual billing [³] |
| Monthly link cap | No cap (your database) | Free 5 → Core 100 → Growth 500 → Premium 3,000/mo [¹] | Free 10 → Essentials 250 → Professional 1,500 → Growth 3,500/mo [²] | Account totals, not monthly: Free 1,000 → paid tiers higher [³] |
| Custom domain | Unlimited (your DNS) | From Growth **$29/mo** annual [¹] | 1 on Free; more on paid [²] | 5 on Free; more on paid [³] |
| Branded links | Yes | From Growth [¹] | Yes (paid tiers) | Yes, incl. Free [³] |
| City-level analytics | Yes (edge header, no IP stored) | From Premium **$199/mo** annual [¹] | From Professional [²] | see vendor [³] |
| Mobile deep linking | `deepLink` flag (no app-store routing) | From Premium [¹] | From Growth [²] | Pro tier and up [³] |
| Self-hosting / own data | **Yes** — Docker Compose, your Postgres | No | No | No |
| Source available | **Yes** — MIT | No | No | No |

Sources, accessed 2026-11-02:
[¹] Bitly pricing — [bitly.com/pages/pricing](https://bitly.com/pages/pricing) (default toggle: annual billing).
[²] Rebrandly pricing — [rebrandly.com/pricing](https://www.rebrandly.com/pricing) (monthly and annual both shown; annual-per-month in parentheses).
[³] Short.io pricing — [short.io/pricing](https://short.io/pricing) (default toggle: annual billing); link/domain/click limits also per [Short.io docs](https://docs.short.io/articles/managing-your-account-and-domains/manage-your-account/how-to-check-the-number-of-created-short-links-and-domains).

This is a product-surface comparison of publicly listed plans, not an endorsement
or a benchmark. SnapURL does not try to match every feature of a mature
commercial product — see [docs/COMPETITIVE-GAP-ANALYSIS.md](./docs/COMPETITIVE-GAP-ANALYSIS.md)
for an honest account of what it does not yet do (forms, app-store deep linking,
OAuth sign-in, bulk create and CSV export).

## Quick start

Build and test everything — no database needed:

```bash
pnpm install
pnpm build
pnpm test
```

Running the apps needs Postgres **18** specifically (the schema calls `uuidv7()`,
native in 18 and absent in 17) on port **5433**, which
[`docker-compose.yml`](./docker-compose.yml) provides:

```bash
pnpm db:up          # Postgres 18 on :5433
pnpm db:migrate
pnpm db:seed
pnpm dev            # the API, redirect and worker
pnpm dev:web        # the dashboard, separately
```

[docs/BACKEND.md](./docs/BACKEND.md) has the full sequence, the ports and the
seeded login.

### The frontend runs without a backend

`NEXT_PUBLIC_USE_FIXTURES` is opt-in and defaults to **off**
([`web/src/lib/api/client.ts`](./web/src/lib/api/client.ts)), so `pnpm dev:web`
talks to the real API. Set it to `"true"` in `web/.env.local` to serve the whole
dashboard from `web/src/lib/api/fixtures.ts` with no API and no database — useful
for frontend-only work. A production build with fixtures enabled fails outright
rather than shipping invented data.

## Self-hosting

SnapURL self-hosts as a single Docker Compose stack on one machine: Postgres, the
three server images from GHCR, and [Caddy](https://caddyserver.com/) for automatic
TLS. From a clean machine it is a handful of commands:

```bash
git clone https://github.com/DhananjayThomble/URL-Shortener-App.git
cd URL-Shortener-App/deploy/single-node
./init.sh                                  # generates the secrets, then edit .env for your domains
docker compose pull
docker compose up -d
docker compose --profile migrate up migrate
```

The full walk-through — DNS and prerequisites, the minimum and optional env vars
(SES, Safe Browsing, OAuth, billing, error tracking), TLS verification, backups,
upgrades, and the AWS CDK path — is in **[SELF-HOSTING.md](./SELF-HOSTING.md)**.
Every command in that guide is tested from a clean machine. A horizontally
scaled Kubernetes/Helm profile and an AWS serverless profile are documented in
[docs/DEPLOYMENT.md](./docs/DEPLOYMENT.md).

## Layout

Eight workspace projects, listed in [`pnpm-workspace.yaml`](./pnpm-workspace.yaml).

| Path | What it is |
| --- | --- |
| `apps/api` | NestJS 11 on Fastify. 40 routes across 11 controllers — the whole dashboard surface. |
| `apps/redirect` | Plain Fastify, deliberately not NestJS. Resolves `(host, slug)` and redirects. Nothing else lives here, because everything here is on the hot path. |
| `apps/worker` | Rollups, the projection outbox and webhook delivery — `apps/worker/src/jobs/`. |
| `packages/contract` | zod schemas. The single source of truth for every payload; imported by both `apps/api` and `web/`. |
| `packages/domain` | Pure logic: routing-chain evaluation, slug generation, visitor hashing. No I/O, no framework. |
| `packages/database` | Drizzle schema, migrations and seed. |
| `web` | Next.js 15 App Router, React 19, Tailwind v4, TanStack Query. |
| `apps/extension` | Manifest V3 Chrome extension. Shortens the active tab against your own API. See [`apps/extension/README.md`](./apps/extension/README.md). |

The two rules that hold it together: the contract package is the only place a
payload shape is defined, and `packages/domain` is imported by both the API that
validates a routing chain and the redirect service that executes it — so there
is exactly one implementation of where a visitor lands.

## Checks

These are what CI runs, in this order
([`.github/workflows/verify.yml`](./.github/workflows/verify.yml)):

```bash
pnpm install --frozen-lockfile
pnpm type-check     # builds packages first, then checks all 7 projects
pnpm build
pnpm test
```

CI then applies the migrations to an empty Postgres 18, starts the API and the
redirect service, and runs `scripts/smoke.sh` and `scripts/smoke-redirect.sh`
against them. It also runs `pnpm check:selfhost-env`, which fails if the
self-hosting guide names an env var that is not in
[`deploy/single-node/.env.example`](./deploy/single-node/.env.example), so the
guide and the example cannot drift apart.

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
| Docker | the database locally; the whole stack when self-hosting |

## Contributing

Bug reports, feature requests and pull requests are welcome. Start with
[CONTRIBUTING.md](./CONTRIBUTING.md) for the workflow and the checks a PR has to
pass, and [CODE_OF_CONDUCT.md](./CODE_OF_CONDUCT.md) for how we work together.
Security issues go through [SECURITY.md](./SECURITY.md), privately, not a public
issue.

## License

[MIT](./LICENSE). © 2023 Dhananjay Thomble.
