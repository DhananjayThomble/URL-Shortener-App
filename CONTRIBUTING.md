# Contributing to SnapURL

Thanks for your interest in SnapURL (the `URL-Shortener-App` repo). Bug reports,
feature requests and pull requests are all welcome. This guide covers how to get
set up, what a change has to pass before it merges, and how we work together.

Please also read the [Code of Conduct](./CODE_OF_CONDUCT.md) — it applies to every
interaction in the project.

## Ways to contribute

- **Report a bug** — open an issue with the [bug report form](https://github.com/DhananjayThomble/URL-Shortener-App/issues/new?template=bug_report.yml).
  Include steps to reproduce, what you expected, and what happened instead.
- **Request a feature** — open an issue with the [feature request form](https://github.com/DhananjayThomble/URL-Shortener-App/issues/new?template=feature_request.yml).
  Describe the problem first, then the change you have in mind.
- **Report a security issue** — do **not** open a public issue. Follow
  [SECURITY.md](./SECURITY.md) to report it privately.
- **Send a pull request** — see the workflow below.

## Getting set up

SnapURL is a pnpm workspace on Node 22. You need:

| | |
| --- | --- |
| Node | 22+ (`engines` in [`package.json`](./package.json)) |
| pnpm | 11.24.0 — `corepack enable` picks up the pinned version |
| Docker | for the local Postgres (Postgres **18**, on port **5433**) |

```bash
git clone https://github.com/DhananjayThomble/URL-Shortener-App.git
cd URL-Shortener-App
pnpm install
pnpm build          # builds the shared packages first
pnpm test           # none of this needs a database
```

To run the apps, bring up the database and start them:

```bash
pnpm db:up          # Postgres 18 on :5433 via docker-compose.yml
pnpm db:migrate
pnpm db:seed
pnpm dev            # API, redirect and worker
pnpm dev:web        # the dashboard
```

[docs/BACKEND.md](./docs/BACKEND.md) has the full local sequence, ports and the
seeded login. For frontend-only work you can run the dashboard with no backend by
setting `NEXT_PUBLIC_USE_FIXTURES="true"` in `web/.env.local` (see the README).

Where things live is described in the [README layout table](./README.md#layout)
and in [docs/ARCHITECTURE.md](./docs/ARCHITECTURE.md). The two rules worth knowing
before you change anything:

- **Payload shapes live in `packages/contract`** (zod schemas) and nowhere else.
  Both the API and the web app import them, so a shape is defined once.
- **Routing logic lives in `packages/domain`** and is imported by both the API
  (which validates a routing chain) and the redirect service (which executes it).
  There is exactly one implementation of where a visitor lands.

## The workflow

1. **Open or find an issue** first for anything beyond a trivial fix, so the
   approach can be agreed before you spend time on it. Issues labelled
   `good first issue` are a friendly starting point.
2. **Fork and branch** off `main`. Name the branch for the work, e.g.
   `fix/redirect-trailing-slash` or `feat/bulk-link-create`.
3. **Make the change** and keep it focused — one logical change per pull request.
   If you touch a payload shape, change it in `packages/contract`; if you touch
   routing, change it in `packages/domain`.
4. **Add or update tests.** A bug fix should come with a test that fails without
   it; a feature should be covered. Tests live beside the code they cover.
5. **Run the checks locally** (below) until they pass.
6. **Open the pull request** against `main`. Reference the issue it closes
   (`Closes #123`), say what you changed and how you tested it, and note anything
   intentionally left out.

We don't enable auto-merge; a maintainer reviews and merges once CI is green.

## Checks a pull request has to pass

CI runs the **Verify** workflow
([`.github/workflows/verify.yml`](./.github/workflows/verify.yml)) on every pull
request. Run the same checks before you push:

```bash
pnpm install --frozen-lockfile
pnpm type-check     # builds packages first, then type-checks all projects
pnpm build
pnpm test
```

CI additionally:

- applies the migrations to an empty Postgres 18 and runs the smoke suites
  (`scripts/smoke.sh`, `scripts/smoke-redirect.sh`) against a composed stack;
- runs `pnpm check:selfhost-env`, which fails if [SELF-HOSTING.md](./SELF-HOSTING.md)
  names an env var that is not a key in
  [`deploy/single-node/.env.example`](./deploy/single-node/.env.example) — so if
  you document a new env var in the guide, add it to the example too (or to the
  documented exceptions in [`scripts/check-selfhost-env.mjs`](./scripts/check-selfhost-env.mjs)
  if it is genuinely not a config key).

The sole **required** status check is the `CI gate`; it depends on the jobs
above. A green gate plus a maintainer review is what merges a change.

> **`pnpm lint` does not work** on purpose — `web/package.json` declares `eslint .`
> with no eslint config or dependency. Don't rely on it; match the style of the
> file you are editing instead.

## Commit messages

Follow [Conventional Commits](https://www.conventionalcommits.org/): a `type(scope): subject`
summary line, e.g. `feat(api): add bulk link create` or `fix(redirect): keep query
string on 301`. Common types are `feat`, `fix`, `docs`, `refactor`, `test`,
`chore` and `ci`. Reference the issue in the body or the PR description.

## Documentation

Documentation changes are always welcome — fixing a wrong command, clarifying a
step, or filling a gap. If your code change affects how someone runs or deploys
SnapURL, update the matching doc in the same pull request:

- user-facing run/deploy steps → [README.md](./README.md), [docs/BACKEND.md](./docs/BACKEND.md);
- self-hosting → [SELF-HOSTING.md](./SELF-HOSTING.md) (and keep the in-app
  `/self-host` page's quick-start consistent — a test enforces it);
- architecture or a design decision → [docs/ARCHITECTURE.md](./docs/ARCHITECTURE.md),
  [docs/DECISIONS.md](./docs/DECISIONS.md).

## License

By contributing, you agree that your contributions are licensed under the
project's [MIT License](./LICENSE).

Thank you for contributing.
