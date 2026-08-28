# How SnapURL is built

A link shortener is a good project to read because it looks trivial and is not.
The interesting parts are all in the constraints: a redirect has to be fast, a
printed QR code has to keep working, and counting visitors without cookies is a
different problem from counting them with cookies.

This is a tour of where those constraints show up in the code. Every claim below
names a file, so you can go and disagree with it.

---

## Why the redirect is its own service

`apps/redirect` is plain Fastify while `apps/api` is NestJS. That asymmetry is
deliberate.

The dashboard API does forty different things and benefits from dependency
injection, guards, pipes and modules. The redirect does exactly one thing, and
every millisecond of it is in front of a person waiting for a page. Putting it
in the same process would mean loading the whole Nest container to answer a
lookup and a 302.

Read `apps/redirect/src/main.ts` and notice what is *missing*: no ORM
relations, no validation pipeline, no auth. It resolves `(host, slug)`, decides
where to go, and fires the click into a sink that does not block the response.

## Where a visitor actually lands

`packages/domain/src/routing.ts` is the most correctness-critical function in the
project, and it is pure — no clock, no randomness, no I/O. Everything it needs
arrives in a `VisitorContext`.

That purity is what lets the same function be imported by `apps/api` to validate
a chain when you save it, and by `apps/redirect` to execute it when someone
clicks. One implementation, two callers, no chance of the preview disagreeing
with the redirect.

The detail worth stealing: **A/B splits are keyed on a hash of the visitor, not
on `Math.random()`**. Random would reshuffle a returning visitor between variants
on every click, which corrupts the experiment and — worse — sends someone
somewhere different from the page they bookmarked.

## Counting people without cookies

`packages/domain/src/visitor.ts` hashes `(daily salt, ip, user agent, link id)`.
The salt rotates daily and yesterday's is deleted by the worker
(`rotateSalts` in `apps/worker/src/jobs/rollup.ts`).

Once a day's salt is gone, that day's hashes cannot be recomputed from an IP by
anybody, including the people running the service. That is what makes the
privacy claim structural rather than a promise.

It has an honest cost, recorded as assumption 9 in
[docs/DECISIONS.md](./docs/DECISIONS.md): uniques reset at midnight UTC, and one
person on two networks counts twice. That is inherent to the design, not a bug —
and it belongs in the UI rather than being discovered by a confused user.

## Why analytics are precomputed

Every dashboard number comes from rollup tables, never from raw click rows.
`rollupClicks` in `apps/worker/src/jobs/rollup.ts` folds click events into
`click_daily` and `breakdown_daily` in one SQL statement per rollup, so the
aggregation happens where the data is.

The subtlety is in `uniques`. Clicks *accumulate* across batches — a day spans
many runs — but uniques are **recomputed** from `daily_visitors` rather than
added to. Adding them would double-count a visitor whose two clicks landed in
different batches, and the symptom is a link reporting more unique visitors than
clicks. The comment above that statement in `apps/worker/src/jobs/rollup.ts`
says so explicitly,
because it is the kind of invariant that is obvious once stated and invisible
otherwise.

## One definition of every payload

`packages/contract` holds zod schemas that both `apps/api` and `web/` import. Not
similar types in two places — the same objects.

This was learned the hard way. `web/src/lib/api/types.ts` used to be a 321-line
hand-copy, and by the time it was replaced it had drifted from the API by five
fields and eleven input schemas. Nothing failed, because nothing could fail: two
files agreeing is not something a compiler can check when neither imports the
other.

The same schemas drive form validation, so the rule the API enforces is the rule
the form applies.

## Things that only a real database catches

Part 2 of [docs/DECISIONS.md](./docs/DECISIONS.md) chose Vitest against a real
Postgres over Jest with mocks, on the grounds that "real Postgres in CI catches
the SQL bugs that mocks hide". `.github/workflows/verify.yml` is where that
happens: it starts Postgres 18 as a service, applies the migrations to an empty
database, and only then runs the tests.

The reasoning generalises. A mocked query replays whatever the test author
assumed, so it can only confirm the assumption — and in `LinksService.list`,
where the "expiring" and "expired" filters are raw SQL predicates compared
against a moving `now`, the assumption is the entire risk. Mock the things you
own; use the real thing for the things you do not.

## Where to start reading

1. `packages/contract/src/link.ts` — what a link *is*.
2. `apps/redirect/src/main.ts` — the shortest path through the system.
3. `packages/domain/src/routing.ts` — the decision, in isolation.
4. `apps/api/src/links/links.service.ts` — the same concepts with persistence.
5. [docs/DECISIONS.md](./docs/DECISIONS.md) — every judgement call, and what
   would justify changing it.

Running it locally: [docs/BACKEND.md](./docs/BACKEND.md).
