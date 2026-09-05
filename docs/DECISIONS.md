# SnapURL 2.0 — backend decisions

Every choice here was made without you in the room. Each one records what I picked, what I
picked it over, and what would make me change my mind. If a decision turns out wrong, the
"Revisit if" line is the trigger.

Companion document: [BACKEND.md](./BACKEND.md) for how to run it.

---

## Part 1 — The nine contract gaps

These came out of reading `web/src/lib/api/types.ts` and `hooks.ts` against the endpoint table
in `web/README.md`. Each was a place the frontend implied something the contract did not say.

### G1 · `PATCH /links/:id` did not exist

**Decision.** Added `PATCH /links/:id`, taking a partial `UpdateLinkInput` and returning the full
`Link`.

The hooks only had create and delete, but the entire product promise is "print it once, change
where it points forever." A link you cannot edit makes the QR feature dishonest. `UpdateLinkInput`
is `CreateLinkInput.partial()` minus `domain` and `slug` — moving a link to a different slug is a
different operation with different semantics (the old slug 404s, breaking printed material), so it
is deliberately not a field you can PATCH. If you want it later it should be an explicit
`POST /links/:id/move` that forces you to decide what the old slug does.

**Revisit if** you decide slug changes should be allowed. Then `move` needs a tombstone table.

### G2 · Logout was client-side only

**Decision.** Added `POST /auth/logout`, which revokes the refresh-token family server-side.

`useLogout` in the frontend clears `localStorage` and nothing else, so the refresh token stayed
valid for its full 30-day life after the user "signed out." Anyone who had captured that token —
shared machine, XSS, a synced browser profile — kept access indefinitely. This was the only finding
in the nine I would call a security bug rather than a gap.

The frontend needs a one-line change to call it. Noted in Part 4.

**Revisit if** never. This one is not optional.

### G3 · Password-protected links had no way to submit a password

**Decision.** Added `POST /public/links/:slug/unlock`, returning a 5-minute JWT scoped to that one
link. The redirect accepts it as `?k=<token>`.

`CreateLinkInput` accepted a `password` and `Link` reported `passwordProtected`, but no endpoint
let a visitor actually supply one. I chose a short-lived token over the two alternatives:

- *Returning the destination directly from the unlock call* would bypass click recording, so
  password-protected links would silently report zero analytics.
- *Setting a cookie* would violate the "no cookies set" promise that is on the landing page, in the
  settings screen, and on the public preview page.

A token in the query string is visible in browser history, which is why it expires in five minutes
and is bound to a single link id.

**Revisit if** you add server-side sessions for any other reason. Then the unlock belongs there.

### G4 · `GET /links` returned `total` but took no pagination

**Decision.** Added `?limit=` (default 50, max 100) and `?cursor=`, keyed on `(created_at, id)`.

Returning `total` only makes sense next to a page, and the hook sent only `?status=`. I chose a
cursor over offset because links are inserted continuously — with `OFFSET`, creating a link while
someone pages shifts every subsequent row and they silently skip one.

Calling it with no parameters returns the first 50 with a `nextCursor`, so the existing frontend
code keeps working untouched. It just stops loading the whole table once a workspace is large.

**Revisit if** the UI grows a "jump to page 7" control, which cursors cannot serve.

### G5 · `expiresTo` was write-only

**Decision.** Added `expiresTo` to the `Link` schema.

It existed on `CreateLinkInput` but not on `Link`, so an expired link's fallback destination could
be set once and then never read back or edited — invisible in the UI and impossible to correct.
Almost certainly an oversight rather than a design choice.

### G6 · `Member.twoFactor` had no flow behind it

**Decision.** Built the full TOTP module: `POST /auth/2fa/setup`, `/enable`, `/disable`, plus
recovery codes and a login challenge.

The team page renders a 2FA column, which means the field has to come from somewhere real. Login
now returns either a session or `{ challenge: "totp", challengeToken }`, and the client posts the
code back to `/auth/2fa/verify`. Recovery codes are ten single-use argon2 hashes issued at
enrolment — without them, a lost phone means a lost account and a support burden you do not want
on a side project.

This is the largest of the nine by build cost. It is also the one you could defer: nothing breaks
if `twoFactor` is always `false`.

**Revisit if** you want WebAuthn instead. TOTP is the pragmatic choice for a self-hostable product
because it needs no domain binding.

### G7 · Revenue was a bare number

**Decision.** Store `value_minor` as a `BIGINT` of minor units plus an ISO-4217 `currency` code.
Workspaces carry a default currency; `ConversionsReport` now reports its currency.

`ConversionsReport.revenue` was a float with no unit. Two things go wrong: floats lose cents at
scale, and the first customer reporting in USD alongside your INR silently sums into a meaningless
number. Mixed-currency reports now return the workspace default and convert nothing — reporting a
converted total would require a rate source and a rate date, which is a product decision, not a
backend one.

**Revisit if** you take payments in multiple currencies. Then you need a rates table and an
explicit "as of" date on every report.

### G8 · `sparkline` length was unspecified

**Decision.** Exactly 30 entries, oldest first, zero-filled for days with no clicks.

The contract said `number[]`. A ragged array makes the chart component render inconsistent widths
between links. Zero-filling rather than omitting empty days is what makes the 30 positions mean the
same thing on every row.

### G9 · The v1 Mongo data

**Decision.** v2 is greenfield. There is an import script at
`packages/database/scripts/import-v1.ts`, and it must run before v2 accepts its first write.

`url_collection` has live documents with `shortUrl`, `visitCount` and `customBackHalf`. The
unrecoverable failure mode is a v2 link claiming a slug that a v1 link already owns — printed QR
codes and shared links would start resolving to the wrong destination, and there is no way to
detect it after the fact.

So the import runs first and reserves every v1 slug, or you accept that v1 slugs die. What you
cannot do is run both and hope. The script maps `shortUrl`/`customBackHalf` → `links.slug`,
`originalUrl` → `destination`, `visitCount` → a single synthetic `click_daily` row dated at
import time, and `category` → a tag. It is idempotent and refuses to overwrite an existing slug.

**Assumption I could not verify:** I do not know whether the v1 database still has live traffic. If
it does not, delete the script and move on.

---

## Part 2 — Stack choices

| Concern | Chose | Over | Why |
| --- | --- | --- | --- |
| HTTP adapter | Fastify | Express | ~2× throughput, lower cold-start allocation, first-class in Nest 11 |
| ORM | Drizzle | Prisma | No query-engine binary — much smaller Lambda bundle and faster cold start. Analytics needs hand-written SQL anyway |
| Validation | zod v4 + a hand-written pipe | `nestjs-zod`, class-validator | Reuses the frontend's schemas verbatim. I dropped `nestjs-zod` mid-build: the pipe is 20 lines, and writing it myself let the error body match what `web/src/lib/api/client.ts` already parses — that client reads `message` as a string or array of strings, so the error shape is part of the contract whether the contract file says so or not |
| Password hash | argon2id | bcrypt | Memory-hard. bcrypt silently truncates at 72 bytes, which turns a long passphrase into a weaker secret than the user thinks |
| Sessions | 15-min JWT + rotating refresh | Long-lived JWT | Rotation with reuse detection revokes a whole token family on replay |
| IDs | UUIDv7 | Serial / UUIDv4 | Time-ordered, so cursor pagination and index locality both work. Not guessable, unlike serial |
| Background work | SQS + Lambda | BullMQ + Redis | ElastiCache is ~$12/mo minimum; SQS's free tier is 1M requests/month forever. Cost was the deciding factor |
| Scheduling | EventBridge Scheduler | node-cron | Survives redeploys and scale-to-zero. v1's node-cron dies with the process |
| Logging | nestjs-pino | winston | Structured JSON straight into CloudWatch Logs Insights with no transport plugin |
| Config | SSM Parameter Store | Secrets Manager | Standard parameters are free; Secrets Manager is $0.40/secret/month |
| Tests | Vitest + Testcontainers | Jest + mocks | Real Postgres in CI catches the SQL bugs that mocks hide |

### Things I deliberately did not use

**Redis, per profile.** I used to reject Redis outright. That was the right call for the AWS
serverless profile and the wrong call to apply to every profile. The CacheStore port (#285,
`packages/cache`) makes the store a swappable adapter, so the Redis decision is now recorded per
profile rather than globally, chosen at deploy time by `CACHE_DRIVER`.

- **Single-node / local / compose:** the in-memory CacheStore, and it is the default. Nothing to
  run alongside the app, no container to warm, no extra dependency. This is what CI, docker compose
  and any single-node deployment use, and it covers hot-link caching and rate-limit counters
  perfectly well when there is exactly one process.
- **Scaled / self-host:** Redis. For a self-hostable product Redis is the most portable scaling
  primitive there is. One container, runs anywhere, and it covers caching, rate-limit counters,
  queueing and sketch merging at the same time. This is the profile where the in-memory counter's
  limit x instances bug actually bites (each instance keeps its own Map), and a shared Redis counter
  is what makes the configured limit the effective limit. Revisit if a deployment already runs Redis
  for something else, in which case this is free.
- **AWS serverless:** DynamoDB + SQS + CloudFront, and Redis is still rejected here. Every use I had
  for it in this profile (rate limit counters, the click queue, caching) is served by DynamoDB, SQS
  or CloudFront at a lower cost, and adding ElastiCache would nearly double the monthly bill (roughly
  $12/mo minimum) to solve problems this profile does not have. That is the original reasoning,
  preserved and still correct.

The DynamoDB adapter exists in code (`packages/cache`); the CDK DynamoDB cache table was the
Phase-7 follow-up (#288), and #288 wires it: the stack now provisions a `CacheTable` and sets
`CACHE_DRIVER=dynamodb` on the redirect (see Profile 3 below), so the AWS profile's `CacheStore` is
genuinely DynamoDB rather than the per-instance in-memory default. The point of the port is
precisely that this stays a per-profile config choice, not a rewrite.

**A GraphQL layer.** The frontend is TanStack Query over REST and the contract is already typed
end to end. GraphQL would add a schema to keep in sync with no caller asking for it.

**Nest microservices / an event bus between apps.** The three apps share a database and a queue.
An internal transport would be ceremony.

---

## Part 3 — Assumptions I made without asking

1. **Region is `ap-south-1` (Mumbai).** Inferred from the repo's `+0530` commit timestamps and the
   fixture data leading with India. Everything region-specific reads from config, so changing it is
   an env var.

2. **`web/` stays at the repo root.** A pnpm workspace does not require moving it. Fewer moving
   parts than restructuring an app that already works.

3. **The root `package.json` now drives the v2 monorepo.** The v1 convenience scripts still exist,
   renamed with a `v1:` prefix (`v1:backend`, `v1:frontend`). Nothing in `backend/` or `frontend/`
   was touched. I renamed rather than deleted because I do not know if v1 is still deployed.

4. **Postgres runs on port 5433 locally.** 5432 is already taken on this machine by another
   project's container (`cj-next-db`).

5. **One workspace per user at registration.** The contract has `workspaces/current` (singular) and
   no workspace switcher in the UI. Registration creates a personal workspace and an `owner`
   membership. The schema is many-to-many, so multi-workspace is a UI change, not a migration.

6. **Bot filtering uses a User-Agent list, not the IAB paid feed.** The IAB spiders-and-bots list
   costs money. A regex list catches the obvious crawlers, and `is_bot` is a column, so
   reclassifying later is an UPDATE rather than a re-ingest.

7. **GeoIP uses CloudFront's `CloudFront-Viewer-Country` header (ISO 3166-1 alpha-2).** This is
   now consistent with both the code and the CDK stack. The AWS profile's origin request policy in
   `infra/lib/snapurl-stack.ts` forwards `CloudFront-Viewer-Country` (and `CloudFront-Viewer-City`)
   to the redirect origin, so `apps/redirect/src/main.ts` reads
   `request.headers['cloudfront-viewer-country']` and populates `click_events.country`. It was
   *not* forwarded before #274 — the header existed at the edge but the origin request policy
   dropped it, so country was always null; it is forwarded now. Country is free and accurate at
   country level, which is all the contract reports, with no MaxMind database to ship or license.
   The city-level detail on the same header family, and the two limits that come with it, are in
   Part 4b ("City-level geo").

8. **Click limits may overshoot slightly.** The click-limit gate reads a denormalised counter in
   the Postgres `link_counters` table (`packages/database/src/schema/links.ts`), recomputed by the
   rollup worker (`apps/worker/src/jobs/rollup.ts`) and read as `coalesce(link_counters.clicks, 0)`
   by the gate in `apps/api/src/links/links.service.ts` and `apps/redirect/src/resolver.ts`. It is
   *not* a live count and *not* a DynamoDB conditional write — the counter moved off the `links`
   table into `link_counters` in #270. Under concurrent clicks a hard cap can be overshot by a
   handful because the gate reads the last rollup's value, which is the same bounded overshoot the
   DynamoDB projection path carries at projection time (see the Profile 3 section later in this
   file — the two resolvers cannot disagree beyond the rollup lag they share). The alternative, a
   synchronous read-modify-write on the hot path, costs more latency than the accuracy is worth for
   a feature whose main use is "roughly 500 beta invites."

9. **Uniques reset at 00:00 UTC and a visitor on a new network counts twice.** This is inherent to
   the cookieless daily-salt design the product promises, not a bug. It should be said plainly in
   the UI rather than discovered by a confused user.

10. **Safe Browsing is behind a feature flag, defaulting off.** It needs a Google API key I do not
    have. With the flag off, links are created with `safeBrowsing.status = "clean"` and a
    `checkedAt` of now, without anything being checked.

    This was called "the assumption most likely to mislead", because the UI claimed links were
    scanned when they were not. The copy has since been removed rather than softened — the landing
    page, the create drawer and `/p/[slug]` no longer say anything is scanned. Set
    `GOOGLE_SAFE_BROWSING_API_KEY` and the claim can come back, this time truthfully.

    **Egress caveat (see the natStrategy entry in Part 4b).** Even with a key set, Safe Browsing
    calls Google's API from inside the backend, so it only *functions* when the AWS profile has
    egress — i.e. `natStrategy != 'none'`. Under the default NAT-instance profile it works; under
    `natStrategy = 'none'` (the free zero-egress topology) the call cannot leave the VPC, so the
    feature is non-functional there regardless of the key.

11. **Email is stubbed, and only one message exists.** `MailService.sendInvite` is the only mail
    the system sends; with `MAIL_TRANSPORT=outbox` (the default) it writes each message to a file
    instead of sending. The outbox directory defaults to `os.tmpdir()/snapurl-outbox` and is
    overridable via `MAIL_OUTBOX_DIR`. It used to write to `process.cwd()/logs/outbox`, which
    threw `EROFS` on Lambda — whose filesystem is read-only except for `/tmp` — so every invite
    500'd; writing to a writable tmp dir fixes that crash. SES needs a verified domain and a
    sandbox exit request and remains unwired (the `MAIL_TRANSPORT=ses` branch still logs "not
    wired yet; message dropped") — future work, out of scope here.

    This entry used to say invitations, verification *and* password reset were stubbed. There is
    no verification flow and no password reset flow — not stubbed, absent: no endpoint on
    `AuthController`, no method on `MailService`. A user who forgets their password currently has
    no way back into their account. `MailerPort` was named here as the seam for wiring SES; it
    does not exist either, only a comment mentioning it. The seam is `MailService.send`.

    **Egress caveat.** Once SES is wired, actually delivering mail (like Safe Browsing and
    webhooks) needs egress, so it only functions when `natStrategy != 'none'`.

12. **No rate limit on the redirect path.** Rate limiting the dashboard API protects the database;
    rate limiting redirects would mean a state lookup on the hot path. The edge absorbs only a
    narrow band of volume, not a blanket cache of every redirect: the CloudFront KeyValueStore fast
    path answers edge-eligible simple links, and the `RedirectCdn` default behaviour uses a short
    1–5s edge TTL cache policy (`defaultTtl` 1s, `maxTtl` 5s in `infra/lib/snapurl-stack.ts`,
    replacing the earlier `CACHING_DISABLED`) that coalesces burst and QR-scan storms. Everything
    else reaches the origin, and the browser is sent `no-store` (from `cacheHeadersFor()` in
    `packages/domain/src/destination.ts`), so no visitor caches a stale 302. Abuse protection on
    the redirect path therefore belongs at WAF, which costs money — and, because caching is
    effectively disabled for correctness, a WAF *raises* the per-1M marginal cost rather than
    lowering it (it inspects every redirect, including the ones the edge would otherwise serve
    cheaply). The corrected figure is in [DEPLOYMENT.md](./DEPLOYMENT.md)'s cost section: roughly
    $1.57 + $0.60 ≈ **$2.17 per 1M**, not a fall to ~$1.10.

---

## Part 4 — What the frontend needs to change

The backend is written so the current frontend works unmodified against it. These are the
follow-ups that unlock the gaps above.

| Change | Why | Blocking? |
| --- | --- | --- |
| Call `POST /auth/logout` in `useLogout` | Otherwise refresh tokens survive sign-out (G2) | **Yes — security** |
| Add `useUpdateLink` calling `PATCH /links/:id` | Editing a destination is the core promise (G1) | Yes — feature is dead without it |
| Handle the `{ challenge: "totp" }` login response | Otherwise 2FA users cannot sign in (G6) | Only if 2FA is enabled |
| Add an unlock form on `/p/[slug]` | Password links are unreachable otherwise (G3) | Only for password-protected links |
| Read `nextCursor` from the links response | Large workspaces silently truncate at 50 (G4) | Not yet |
| Soften the "scanned on creation" copy | Safe Browsing is off without an API key (A10) | Not yet, but it is a truth claim |
| Soften the "31 ms median redirect" copy | Regional Lambda is 30–60 ms in-region, worse abroad | Not yet |

---

## Part 4b — Decisions the build forced, that the design did not anticipate

These were not in the plan. Each one is a place where writing the code taught me
something the architecture document had wrong.

### The shared short domain is owned by nobody

**Found by:** the second person to register got a workspace with no domain and could
not create a single link.

The design had each workspace own its domains, and registration attached the default
domain to the new workspace. But domains are globally unique — they have to be, or
`(host, slug)` on the redirect path is ambiguous — so only the *first* workspace ever
got one.

`domains.workspace_id` is now nullable, with `is_system = true` marking the shared
short domain every workspace can put links on. Custom domains still belong to exactly
one workspace. The redirect path does not care which kind it resolved, and the
domains list shows both — with the link count scoped to the caller, because on a
shared domain other workspaces' links are none of their business.

This is how the fixtures always looked, in hindsight: `snap.to/spring-sale` alongside
`go.acme.com/demo`. I just did not read it that way until it broke.

### Drizzle wraps driver errors, so `err.code` stops matching

**Found by:** a duplicate back-half returned `500 Internal server error` instead of the
409 with a helpful message that the code clearly intended.

Drizzle 0.44 wraps the driver error in a `DrizzleQueryError` and puts the real
`PostgresError` — the one carrying `code: "23505"` — on `.cause`. Every
`err.code === "23505"` check in the codebase was silently false.

Fixed by walking the cause chain, and then by adding `PostgresErrorFilter` as an
application-wide backstop so that no constraint violation can ever reach a user as
"Internal server error" again, including ones nobody anticipated.

### Postgres 18, not 17

`uuidv7()` is native in Postgres 18 and does not exist in 17. The alternative was
shipping our own SQL function in the first migration. I took the version bump because
PG18 has been out for a year, but it does raise the floor for self-hosters — worth
knowing if that matters to you.

### A correlated subquery in a Drizzle projection counted zero

**Found by:** the domains page showed "0 links" for a domain with six.

The raw `sql` fragment referenced a table that was not in the outer `FROM`. It did not
error, it just returned zero. Replaced with an explicit grouped query — an extra round
trip is cheaper than a number that is quietly wrong. There is now a smoke assertion
for it, because a wrong count is exactly the kind of bug that survives code review.

### Analytics and conversions disagreed

The analytics stat tile read conversions from the click rollups, where they do not
live, so it always showed zero while the conversions page reported hundreds. Two
screens contradicting each other is worse than either being wrong alone — it teaches
someone to distrust both. Analytics now counts the conversions table directly.

### Config is resolved at deploy time, not at cold start

**The constraint (as it originally stood).** The Lambdas sat in isolated subnets with no
NAT, because a NAT gateway costs more per month than everything else in the stack
combined. Nothing in there could call the SSM or Secrets Manager API without an
interface VPC endpoint, at about $7/month each — roughly half the database bill, per
endpoint, to move a value from one place the account owner can read into another place
the account owner can read.

**Update:** this rationale no longer strictly holds. `natStrategy` now defaults to a NAT
instance (see the natStrategy entry below), so the app Lambdas have egress and a runtime
SSM/Secrets Manager lookup is reachable over the NAT without a dedicated endpoint. That
makes a runtime lookup a *viable future change* (issue #292) rather than a $7/month
upgrade. It is deliberately not implemented here — deploy-time resolution stays as-is —
and under `natStrategy = 'none'` the original no-egress constraint still applies.

**What I did instead:** CloudFormation resolves both stores at deploy time.
Ordinary config comes from SSM Parameter Store (`/snapurl/<stage>/*`, free at
standard tier), and the three secrets — the database password and the two JWT
signing keys — are *generated* into Secrets Manager by the stack, so no human ever
chooses them and no secret value is ever typed into this repository or baked into a
container image. The images carry no configuration at all, which is what makes the
same image deployable to any stage.

**What it costs:** changing a value takes a redeploy rather than taking effect on
the next cold start. For a signing key that is the right shape anyway — rotating one
invalidates every token it signed, so it is a deliberate operation. For a log level
it is mildly annoying. The upgrade path is a runtime lookup — no longer gated on a
$7/month interface endpoint now that the default NAT profile gives these Lambdas
egress (issue #292) — and the day it becomes worth doing is the day someone else has
console access to this account.

**The one thing this does not do** is hide a value from anyone who can read a
Lambda's configuration. That was already true of the database password before this
change, and it is the same trade, made once, for the same reason.

### Forms: answers are keyed by a frozen field key, and never rewritten

**The design pass #239 asked for. These are the decisions that are expensive to change
once responses exist.**

**Field definitions live in JSONB on the form, not in a `form_fields` table.** A form is
read and written as a whole document, and every integrity constraint that matters —
field order, key uniqueness — is *within* that document. A table would add a join to
every read and a position column to maintain, in exchange for per-field queryability
nobody needs.

**Answers are keyed by a stable field `key`, never by a field id and never by the
label.** This is the decision the whole module turns on. A form gets edited: labels are
rewritten, fields are reordered, some are deleted. If answers were keyed by label, a
typo fix would orphan every response already collected. The key is derived from the
label once, at field creation, and then frozen — editing the label afterwards changes
what the form *says* and not what its history *means*.

**A response is never rewritten when its form changes.** Old responses keep the keys
they were submitted with. The alternative — migrating stored answers to match the
current definition — means a form edit silently rewrites history, and a mistaken edit
is unrecoverable.

Which forces the export rule: **CSV export unions every key ever seen in the response
set**, not just the keys the form currently has. A deleted field's historical answers
are still exported. Exporting only current fields would mean deleting a field quietly
destroys the answers people gave to it, in the one artefact meant to be the durable
record.

**One row per submission with a JSONB `answers` object, not one row per answer.** The
read pattern is whole submissions — a response table and an export. EAV would need a
join per field for every read and turn the export into a pivot.

**On privacy, because this module inverts the posture the rest of the product holds.**
Click analytics deliberately observe as little as possible about visitors who never
chose to be measured. A form is the opposite: its entire purpose is to collect what
someone typed. The distinction that makes both honest is consent — a response is
volunteered by a person who chose to fill the form in, an impression is not. So the
existing claims stay literally true (a form sets no cookies and stores no IP), and the
new obligations that come with holding volunteered data are the ones this module has to
meet: the public page names the workspace collecting it, and responses are deletable.

### Billing: the controls are removed rather than faked

**Asked by #242, whose own answer — "removing is the honest interim state" — is the one
I took, for a reason worth recording.**

Real billing is not buildable here. There is no payment provider configured, no
credentials for one, and the brief this work runs under does not add dependencies — a
provider SDK is exactly that. So the choice was never "implement or remove"; it was
"remove, or leave a button that lies."

What was actually unbacked, once separated from what was real:

| | |
| --- | --- |
| `Manage billing` button | **Nothing behind it.** No payment integration, no upgrade path. Removed. |
| The click quota bar | `clicksUsed` is genuinely counted from the rollups. `clicksIncluded` is a real column that **nothing reads but the display** — no code anywhere enforces it. The bar therefore drew a cap that does not exist, filled to 100%, and kept going. Now a plain count. |
| "Five domains on the free plan" | Contradicted the settings page, which said Custom domains: Unlimited. Nothing enforces either. The landing page was the unbacked one. |

`clicksIncluded` stays as a column and a contract field. It is real data, and a future
billing implementation would want it — the problem was presenting it as a limit, not
storing it.

The domains contradiction is the part worth dwelling on. Two screens disagreed about the
same number and neither was enforced, which is the same failure as the analytics and
conversions disagreement above: a reader who notices stops trusting both screens, not
just the wrong one.

**What would revisit it:** a decision to charge for this, which needs a provider, a
plan model, entitlement enforcement on the write paths, and an upgrade/downgrade
lifecycle. That is a feature, not a button. Until it exists, the settings page says
everything is free and nothing is metered, which has the advantage of being true.

### Third-party tracking pixels: declined

**Asked by #243, which was right to refuse to be implemented silently.**

The competitor offers Meta and Google pixels on redirects. This does not, and the
decision is to keep it that way. Four reasons, in the order they'd bite.

**It cannot be done with a 302.** A pixel has to execute in the visitor's browser, so
the redirect stops being a redirect and becomes an HTML interstitial that loads
third-party script, waits for it, then navigates. That throws away the reason
`apps/redirect` exists as a separate dependency-light service on the hot path, and it
puts a full page load in front of every QR scan on mobile data. The smoke suite now
asserts that a successful redirect is a 3xx and not HTML, so this cannot be reintroduced
by accident.

**It is unlawful in the EU and UK without prior consent.** ePrivacy requires consent
before non-essential third-party storage. So the interstitial needs a consent banner —
a cookie banner in the middle of a redirect, shown to everyone who clicks a short link.
That is a worse product than not having the feature, and the version without the banner
is worse still, because it is illegal rather than merely annoying.

**Three public claims would have to be reworded**, and the schema's guarantees would
stop being mechanisms and become marketing: "no tracking cookies" on the landing page,
"we do not set cookies, and we never sell click data" on the public preview page, and
"nothing is stored on their device" in settings. Giving click data away to Meta for
free is not meaningfully better than selling it.

**The need behind the request is already met, server-side.** People asking for pixels
want ad-campaign attribution. `POST /conversions` exists for exactly that — scoped to an
API key so the customer's own site reports the conversion — alongside
`conversion.recorded` webhooks and UTM forwarding, so the advertiser's own analytics
attributes the click. That reaches the same business outcome without putting a third
party on the visitor's device, and it keeps working for the growing share of visitors
whose browsers block pixels outright.

**What would revisit it:** a deliberate decision to stop competing on privacy. #243
already describes the honest shape if so — opt-in per link, disclosed on the public
preview page, marketing copy changed first. The ordering in that sentence is the
important part: copy first, then disclosure, then code. Shipping the code first is how
a privacy product becomes a surveillance product without anyone deciding to.

### City-level geo: CloudFront's header, never an IP, never coordinates

**Asked by #240, which was right to block on it.**

Three options, and the licensed GeoIP database is excluded twice over. It needs the
visitor's IP in the redirect process's memory to do the lookup, which reintroduces
exactly what `click_events` was designed without, and it means shipping megabytes of
database into a 512 MB Lambda that sits on the hot path.

**What I chose:** CloudFront resolves the IP at its edge and hands us
`CloudFront-Viewer-City` as a header, already a name. Our code never sees an IP for
geolocation. `click_events` still has no `ip` column, no cookie is set, and nothing is
stored on the visitor's device — every claim on the landing page and the settings page
stays literally true, which is the bar #217 set and I did not want to quietly lower.

**But city is more identifying than country, and that is the part worth saying out
loud.** Country plus device plus browser identifies nobody. City plus device plus
browser plus OS plus referrer, in a small enough place, can. So two limits come with
it:

- **The city name only. Never `CloudFront-Viewer-Latitude/Longitude`,** which the same
  header family offers and which is the easy mistake to make — they are adjacent in
  AWS's documentation. A city name is a population; a coordinate pair is a location.
- **A k-anonymity floor of five.** A city with fewer than five clicks in the window is
  folded into "Other cities" rather than given its own row. The total still adds up, so
  the workspace loses no volume — but "Bengaluru · 1 click" never renders beside a
  single iPhone and a single referrer. The threshold is one named constant, so raising
  or removing it is a one-line decision rather than an archaeology exercise.

**What it costs:** coverage. CloudFront's city data is coarse and frequently absent,
particularly on mobile networks and behind VPNs. Those clicks roll up as "Unknown".
That is the honest price of not shipping a GeoIP database, and it is visible in the
dashboard rather than hidden.

**What would revisit it:** anyone needing reliable or finer-grained location. That is a
different product with a different promise, and the marketing copy would have to change
before the code did — not after.

### `cdk synth` was staging its own output into itself

**Found by:** running it. The stack merged in #246 did not synthesise at all.

`DockerImageCode.fromImageAsset(repoRoot)` stages the repository into
`infra/cdk.out/asset.<hash>/` — a directory inside the repository it is staging. With
nothing excluding it, each asset copied the previous asset's output, and the third one
died with `ENAMETOOLONG` after nesting the path forty times.

`.dockerignore` already existed and excluded everything else the build does not need;
it simply predates the CDK stack and had never heard of `cdk.out`. Adding it there is
half the fix. The other half is repeating the exclusion on the asset itself, and the
reason is worth writing down because it is not guessable: CDK builds one ordered
pattern list from `.dockerignore` first and the asset's own `exclude` second, and the
**last matching pattern wins**. `.dockerignore` ends with a re-include for
`.env.example`, which was enough to pull those files back out of the excluded
directory and start the recursion again — one `.env.example` deep per level. Listing
the exclusion on the asset puts it after that negation, which is the only ordering
that holds.

Verified by synthesising twice from clean: three assets, 1.4 MB each, identical
across runs, and the nested `cdk.out` directories left empty.

### Egress is a property of the AWS profile: `natStrategy`, defaulting to a NAT instance

**Forced by #281 (a #267 release blocker):** the AWS profile set `natGateways: 0` with
every Lambda in `PRIVATE_ISOLATED` subnets, so nothing in the backend could reach the
internet. Safe Browsing, customer webhooks, Google OAuth (JWKS) and mail all call out —
so all four were dead on arrival, while the docs and UI presented Safe Browsing and
webhooks as working features. That is the contradiction this entry resolves.

**Decision.** Egress is now a configurable property of the stack via a
`natStrategy: 'gateway' | 'instance' | 'none'` prop, wired from
`app.node.tryGetContext('natStrategy')` in `bin/snapurl.ts`, **defaulting to
`'instance'`**: a single t4g.nano NAT *instance* (`ec2.NatProvider.instanceV2`, ~$3/mo)
rather than a managed NAT gateway. A hobby stack does not need the gateway's per-AZ
redundancy, and $3/mo is a fraction of the ~$32/mo a gateway costs. RDS always stays in
`PRIVATE_ISOLATED` (it never egresses); the app Lambdas move to `PRIVATE_WITH_EGRESS`
when NAT is on.

**NAT over IPv6 egress-only.** An egress-only IGW is free, but this was chosen against:
arbitrary customer webhook endpoints cannot be relied on to publish `AAAA` records, so
IPv6-only egress would leave webhook coverage patchy — some customers' endpoints would
simply be unreachable. This was the decision recorded by epic #267; NAT trades a few
dollars a month for reaching any IPv4 endpoint a customer configures.

**The three options.**

| `natStrategy` | Cost | What it is | Egress features |
| --- | --- | --- | --- |
| `'instance'` (default) | ~$3/mo | t4g.nano NAT instance, single AZ (a deliberate SPOF for a hobby stack) | Function |
| `'gateway'` | ~$32/mo | Managed NAT gateway, highly available — the one-flag upgrade | Function |
| `'none'` | $0 | The original zero-egress isolated-only topology, preserved exactly | **Non-functional** |

Under `'none'`, Safe Browsing, webhooks, OAuth (JWKS) and mail delivery are all
non-functional by design — it preserves the free option for an operator who does not
need them and accepts that trade knowingly, rather than being surprised by it.

**What this does and does not do.** This makes egress *capability* exist and be
configurable. Actual end-to-end egress is a deploy-time concern (Phase 7); nothing here
sends a real webhook or email in this environment. And because the default profile now
gives the app Lambdas egress, a runtime SSM/Secrets Manager lookup becomes reachable
without a dedicated interface endpoint — which unblocks, but does not implement, issue
#292 (see the deploy-time-config entry above).

**Revisit if** the single NAT instance's availability becomes a problem (flip to
`'gateway'`), or if a deployment genuinely needs none of the egress features and wants
to save the ~$3/mo (`'none'`).

### Profile 3: the AWS serverless projection and the click pipeline

**Filled in by #288 (Phase 7 of #267):** the ports were already there — `LinkResolver`
in `apps/redirect`, `ClickSink` in `apps/redirect`, `ProjectionTarget` in `apps/worker`
— and Profile 3 is the AWS adapters behind them. Two switches turn them on, both
defaulting OFF so every other profile is byte-for-byte unchanged:

| Env switch | Default | `dynamo` / `sqs` (the AWS profile) |
| --- | --- | --- |
| `LINK_PROJECTION` | `none` — redirect reads Postgres via `PostgresLinkResolver`; worker's `NoProjection` is a no-op | `dynamo` — redirect reads a DynamoDB projection; worker drains `projection_outbox` into it |
| `CLICK_SINK` | `postgres` — redirect `INSERT`s clicks straight into `click_events` | `sqs` — redirect sends an awaited SQS message; the worker drains it back into `click_events` |

Local dev, compose, the single-node profile and the Kubernetes profile all leave both
unset, so they run the exact Postgres paths they always did. Only the CDK stack sets
`dynamo`/`sqs`, and only on `redirectFn`/`workerFn` (never `commonEnv`).

**The projection is one DynamoDB table, keyed by domain.** A LINK item per `(domain,
slug)` carries every field the redirect needs to make a routing decision:

- `PK = 'd#' + normaliseHost(domain)`, `SK = 's#' + slug.toLowerCase()` — the same
  normalisation `PostgresLinkResolver` uses, so a link created against `SNAP.TO/Foo`
  resolves from a request whose Host is `snap.to` and slug is `foo`, identically to
  Postgres.
- a DOMAIN-META item per domain — `SK = 'd#meta'` — holding `{id, rootRedirect,
  notFoundRedirect}` so the root (`/`) and not-found redirects resolve with one GetItem.
  It is (re)written alongside every link upsert on that domain: the simplest way to keep
  `resolveDomain()` current without a second outbox stream, and one cheap extra put.

One `GetItem` per redirect, no join, no connection pool to warm. The item shape and the
`Date`↔ISO-string conversion live in **one** place (`@snapurl/database`'s
`link-projection` mapper), imported by both the worker (writer) and the redirect
(reader), so a field the writer projects cannot drift from the field the reader revives.

**Clicks are a point-in-time value, on purpose.** The projected `clicks` is read from
`link_counters` at projection time, exactly as `gateFor()` already treats it: "the count
is the last rollup's, not a live one." A hard click cap can therefore be overshot by a
handful under concurrency — but it is the *same* overshoot the Postgres path already
carries, so the DynamoDB and Postgres resolvers cannot disagree on the gate beyond the
rollup lag both share. A synchronous live count would cost more latency than the
accuracy is worth on the hot path.

**The delete-key GSI, so the API never changes.** `enqueueProjection` stores only
`{linkId, operation}` in the outbox and the API's delete removes the link row in the
*same* transaction. So at drain time a `delete` cannot read `(domain, slug)` from
Postgres to build the item key — the row is already gone. The issue's constraint is that
the API stays untouched, so the resolution lives entirely on the projection side: the
table carries a `linkId-index` GSI on a top-level `linkId` attribute present on every
LINK item, and `remove(linkId)` queries the GSI for the matching item(s) and deletes
them by their real PK/SK. (A reverse-pointer item was the alternative; the GSI is the
DynamoDB idiom and needs no second write on the upsert path.) An upsert does *not* need
the GSI — the link row still exists for an upsert, so `(domain, slug)` is read straight
from Postgres. A writer test round-trips upsert→remove to prove it.

**SQS as an event source mapping, not a self-managed `ReceiveMessage` loop.** The
worker does not poll the queue. An SQS event source mapping (`SqsEventSource`,
`reportBatchItemFailures: true`) is polled by the Lambda service *outside* the VPC and
delivers a batch as an ordinary `{ Records: [...] }` invocation, which the worker drains
into `click_events` with partial-batch-failure reporting so one bad message does not
reprocess the whole batch. A self-managed `ReceiveMessage` loop would have had to run
*inside* the redirect or a polling Lambda and, to reach SQS from a private subnet, would
have needed an SQS interface VPC endpoint (hourly + per-GB cost) — the ESM needs none,
because the poller lives on the AWS side of the boundary. **This sequencing depended on
3a landing first:** the redirect could only be allowed to leave the VPC once it could
resolve links from DynamoDB (3a) *and* record clicks without a Postgres connection (3b's
SQS sink), so 3a (projection + resolver) had to precede 3b (SQS sink + VPC removal).

**The payoff: the redirect leaves the VPC.** Under `dynamo` + `sqs` the redirect touches
only DynamoDB and SQS — both public AWS endpoints — and `init()` opens no Postgres
connection at all. `redirectFn` drops its `vpcSettings`; `apiFn` and `workerFn` keep
theirs. What that buys:

- **No ENI.** A VPC Lambda attaches an elastic network interface at cold start; a
  no-VPC Lambda does not, so the cold start is faster — the thing that matters most on a
  redirect hot path.
- **No connection pool, no ~109-connection ceiling.** A db.t4g.micro caps at ~109
  connections; a fleet of redirect instances each holding even one pooled connection is
  how that ceiling is hit. DynamoDB and SQS are connectionless HTTP, so redirect
  concurrency no longer competes for RDS connections at all.
- **The 10s-timeout failure mode is gone.** The old fire-and-forget-or-await Postgres
  `INSERT` under the Lambda Web Adapter could pin a backend the pool could not reclaim,
  queueing the next request on a warm instance behind a query that never finishes until
  the function times out. With no Postgres in the redirect there is nothing to pin.

**What made leaving Postgres possible: the CacheStore-backed salt source.** The daily
visitor-hash salt was the last thing tying the redirect to Postgres — it read/wrote the
`daily_salts` table on every request. `SaltSource` now has two implementations behind a
shared caching base: `PostgresSaltCache` (unchanged, used whenever a Postgres handle
exists) and `CacheStoreSaltCache`, which reads/writes the shared `CacheStore`. For that
store to actually be *shared* — the whole point, since a per-instance store would give
every warm redirect its own salt and inflate unique counts by the instance fan-out —
#288 provisions a dedicated `CacheTable` and sets `CACHE_DRIVER=dynamodb` +
`CACHE_DYNAMO_TABLE` on the redirect (with a read/write grant). The `#285` adapter alone
was not enough: without the table and the env var the factory would have defaulted to
the per-instance in-memory store, so the redirect out of the VPC would have fragmented
the salt. With them, a redirect that has left Postgres salts its hashes from a shared
DynamoDB table reachable without a VPC. `CacheStoreSaltCache.load` re-reads the key after
its own write (mirroring `PostgresSaltCache`'s re-read after `onConflictDoNothing`), so
two cold instances racing a new day converge on the surviving value rather than each
keeping its own for the day. The residual race is only the instant between two writes; it
affects unique-visitor counting only, never redirect correctness — the same bounded
imprecision the "no cookies" promise already documents. (`set()` is last-write-wins, not
an atomic `SETNX`; the `CacheStore` port has no first-write primitive, and adding one for
a once-a-day cold-start window is not worth the surface area.)

**The freeze/thaw argument, asserted rather than assumed.** Under the Lambda Web Adapter
the sandbox freezes the moment the redirect responds. A fire-and-forget Postgres
`INSERT` is suspended mid-flight — the click is lost *and* it pins a backend the pool
cannot reclaim. An **awaited** SQS `SendMessage` is an HTTP request that completes and is
acknowledged *before* the response returns, so the click is durably on the queue by the
time the invocation ends; the worker's ESM drains it into `click_events` later. That is
the freeze-safe write #277 wanted, and it is a unit-test assertion, not a hope:
`SqsClickSink` awaits the send, and the worker consumer test feeds it a batch and asserts
every message lands in `click_events` while a single bad message is isolated to
`batchItemFailures`.

**CI-proven vs mock-proven vs deploy-deferred.** Being explicit about what has actually
been exercised:

| Claim | Status | How |
| --- | --- | --- |
| Redirect resolves from DynamoDB under `LINK_PROJECTION=dynamo` (Done-when #1) | **CI-proven** | The `dynamo-smoke` job stands up `amazon/dynamodb-local`, the worker drains the outbox into it, and `scripts/smoke-redirect.sh` passes with every 302/404 served from DynamoDB |
| `SqsClickSink` awaits the send; the worker consumer drains a batch into `click_events` with partial-batch-failure isolation (freeze/thaw survival) | **Mock-proven** | Unit tests against a mocked SDK `send` keyed by command name; the resolver/writer/mapper round-trips are likewise unit-tested |
| CDK shape: PAY_PER_REQUEST + PITR projection table + GSI, single-key `CacheTable` (TTL on `expiresAt`), SQS queue + DLQ, worker ESM with `ReportBatchItemFailures`, `redirectFn` with no `VpcConfig` and `CACHE_DRIVER=dynamodb` + `CACHE_DYNAMO_TABLE` (api/worker keep the VPC, no `CACHE_DRIVER`) | **CI-proven** (synth) | `cdk synth` asserts every resource; no deploy |
| Real no-VPC resolution and the real SQS round trip against AWS | **Deploy-deferred** | Needs a live stack; the sandbox and CI cannot run a real deploy. The CI smoke uses `AWS_ENDPOINT_URL_DYNAMODB` to point the adapters at dynamodb-local — the same optional endpoint override that is unset (a no-op) in production |

**Revisit if** the point-in-time click count's overshoot ever needs to be tighter (a
conditional-write cap on the item is the DynamoDB move), or if the salt race matters
enough to warrant an atomic first-write primitive on the `CacheStore` port.

### Profile 3: the CloudFront Function + KeyValueStore edge fast path

**Built by #289 (Phase 7 of #267, the last thing in the epic):** for the majority of
links that are simple — no password, no routing rules, no click limit, not expired, not
scheduled — the redirect is now answered **at the edge with no origin fetch at all**: no
Lambda invocation, no DynamoDB, no VPC. Expected p50 in India ~10-20 ms against ~245 ms
today. The viewer-request CloudFront Function (JS_2_0), which already copied Host into
`x-forwarded-host` for #274, now also reads a per-link CloudFront KeyValueStore entry and
returns the 302 itself. It falls through to the Lambda origin unchanged for anything
it cannot answer, so correctness never depends on the fast path being complete.

**The design.** A KVS entry `{ destination, redirectType }` per edge-eligible link, keyed
`<host>/<slug>` (both lowercased — the `edgeKey`/`kvsKey` invariant shared with
`@snapurl/database`), written by the **same outbox drain** that writes the DynamoDB
projection (which is why 3a had to come first): each edge-eligible upsert also `PutKey`s
the entry, each ineligible-or-removed link `DeleteKey`s it. The store limits — 5 MB per
store, 1 KB per value — fit a `{destination, redirectType}` JSON comfortably. The Function
guards conservatively before it looks anything up: only a bare `GET` of a single
non-empty path segment, no `?k=` unlock token, no trailing `+` trust-preview convention;
anything else, plus any KVS miss or error, returns the request unchanged so CloudFront
forwards it to the authoritative Lambda origin. A link is **edge-eligible** only when it
is a plain unconditional redirect that the edge can answer exactly the way the Lambda
would. It is **edge-INELIGIBLE** (kept on the authoritative Lambda) when *any* of these
hold:

- a **blocking gate** the edge cannot evaluate: a password, routing rules, a click limit,
  an expiry, an activation time, archived, or a non-`clean` Safe-Browsing status — the
  edge cannot reliably evaluate time or conditions;
- a **transform** the Lambda applies on the happy path and the edge cannot reproduce:
  `forwardQuery` (the Lambda merges the incoming query via `buildDestination`), a non-null
  `utm` (the Lambda injects the stored campaign params), `deepLink` (the Lambda rewrites
  Android destinations into `intent://…` via `buildDeepLink`), or `hideReferrer` (the
  Lambda sets `Referrer-Policy: no-referrer`). The edge returns only the raw stored
  destination, so serving any of these at the edge would drop query forwarding, campaign
  params, Android deep-linking, or the no-referrer header the author asked for;
- a **non-302 redirect type**: only plain **302** links are edge-served; **301** and
  **307** stay on the authoritative Lambda. A 301's permanence is honoured on the Lambda
  with `public, max-age=300` (`cacheHeadersFor("301")`), whereas the edge answers every
  hit with `no-store`. A 307's *exact* status the edge Function cannot emit — its status
  mapping collapses every non-301 hit to 302 (`parsed.redirectType === "301" ? 301 :
  302`), so an edge-served 307 would answer HTTP 302 where the Lambda answers HTTP 307 (via
  `REDIRECT_STATUS`). Rather than special-case the Function, both 301 and 307 fall through
  to the authoritative Lambda.

Because the edge cannot reproduce the Lambda's query-forwarding, UTM injection,
deep-linking, referrer suppression, 301 permanence, or a 307's exact status, those links
stay authoritative on the Lambda; keeping everything else there too is the safest rule.

**The blocking decision — click accounting for edge-served redirects. Chose (c).** A
redirect served at the edge never reaches the click pipeline, and the three ways to
recover the click were:

| Option | What it is | Why not |
| --- | --- | --- |
| (a) CloudFront real-time logs to Kinesis | Full parity with the existing click pipeline | Kinesis is ~$11/month for a single shard — most of the remaining budget on a $100-credit stack |
| (b) Standard access logs to S3, batch-ingested by the worker | Nearly free (the S3 gateway endpoint already exists) | Delayed by minutes, and it forces parsing IPs out of log lines — which **throws away the salted-hash design** that makes the cookieless privacy promise real |
| **(c) Only edge-serve links where per-click accuracy does not matter** (chosen) | Keep the Lambda authoritative for anything with a click limit or an analytics commitment; edge-serve the rest | Smaller latency win, but it is the only option that neither blows the budget nor undoes the privacy design, and the win still applies to the majority of links |

(c) is why the edge-eligibility rule excludes click-limited links: a click limit needs the
authoritative per-click count the Lambda path maintains, and analytics-critical links keep
their salted-hash accounting on the Lambda. The Lambda stays authoritative for the rest;
the edge is a pure latency optimisation over the simple-link majority.

**`CACHING_DISABLED` → a 1-5s edge TTL.** The reasoning behind disabling the cache was
right — a cached 302 makes a destination edit invisible — but the setting was over-broad.
The layer that actually protects "print it once, change where it points forever" is
`cacheHeadersFor()` in `packages/domain/src/destination.ts`, which already sends
`no-store` to the **browser**, so no visitor ever caches a stale redirect regardless of
the edge. A `defaultTtl` of 1s (min 0s, max 5s) on the RedirectCdn default behavior keeps
edits effectively instant — well under a printed QR's reaction time — while absorbing
QR-scan and burst storms that would otherwise each hit the fall-through Lambda origin. The
TTL only helps the **fall-through** path: the viewer-request Function answers simple links
from KVS *before* the cache is consulted, so the fast path is separate. The cache key
includes the query string (`CacheQueryStringBehavior.all()`) so the `?k=` unlock token and
the UTM / forwardQuery overrides key distinct entries — dropping it would let one visitor's
unlock/UTM response be served to the next.

**Reachability — verified before building, not during.** `cloudfront-keyvaluestore` is a
**global public API** with no PrivateLink / interface VPC endpoint (only the free S3 and
DynamoDB gateway endpoints exist in this VPC). The worker writes the store, and under the
default `natStrategy = 'instance'` (and `'gateway'`) the worker Lambda sits in
`PRIVATE_WITH_EGRESS` subnets whose default route is the NAT, so it reaches the public KVS
endpoint over the internet — the same egress path Safe Browsing, webhooks and mail already
use. Under `natStrategy = 'none'` the worker is isolated with no egress, so the KVS writer
cannot reach the API — but that is the *same* limitation those other egress-dependent
features already carry, and the writer is **opt-in**: it is constructed only when
`LINK_PROJECTION_KVS_ARN` is set (which the stack sets on `workerFn` only, granting the
three `cloudfront-keyvaluestore` data-plane actions scoped to the store's ARN). The
Function *reads* the store at the edge via its CloudFront association, which is never in a
VPC, so the read path is unaffected by `natStrategy`.

**CI-proven vs deploy-deferred.** The decision logic (`decide`/`edgeKey`) is unit-tested
against an injectable `kvsGet` — hit, miss, error, and every guard — and a drift-guard
test asserts the deployed `.js` and the tested `.logic.mjs` twin are byte-for-byte
identical in the guarded region, so the tested logic is provably the deployed logic. The
CDK shape (the `AWS::CloudFront::KeyValueStore`, the Function↔KVS association, the worker
IAM grant, `LINK_PROJECTION_KVS_ARN` on the worker, the short-TTL cache policy) is
synth-proven. A real edge invocation and a real KVS round trip are **deploy-deferred** —
CloudFront Functions and KeyValueStores cannot run in CI or the sandbox.

**Revisit if** per-click accuracy on edge-served links ever becomes worth paying for
(option (a) or (b), with the privacy cost of (b) understood), or if the eligibility rule
proves too conservative and a time-bounded link could be safely edge-served with a
carefully evaluated TTL.

### Migration 0007's lock footprint: a forward migration and a runbook, not one or the other

**Raised by #294 (a follow-up from the review of #293):** the migration that turns
`click_events` into a day-partitioned table (`0007_partition_click_events`) is not a
routine migration, it is a scheduled event. It has never actually bitten anyone, because
`click_events` has never been deployed with data and so the migration runs against an
empty table today. But `runMigrations` exists precisely so migrations can be applied to a
live deployed database, so the moment someone self-hosts with existing click history it
matters.

**Three properties make it a scheduled event.**

- **It is one transaction.** Drizzle's migrator wraps all pending migrations in a single
  `session.transaction`, so the `ALTER TABLE click_events RENAME TO click_events_legacy`
  takes `ACCESS EXCLUSIVE` at the start and holds it through the partition-creation loop,
  the full-table copy, and the final `DROP`. Every click insert blocks for the whole
  duration, and neither the pool nor the migration sets a `statement_timeout` to bound it.
- **Its blast radius is wider than `click_events`.** The two `ADD CONSTRAINT ... FOREIGN
  KEY` statements take `SHARE ROW EXCLUSIVE` on `links` and `workspaces`, held to commit,
  so for the duration nobody can create or edit a link either.
- **Its lock footprint scales with history.** Each attached day-partition contributes its
  own relation plus its cloned indexes, roughly five lock slots per day of history. The
  shared lock table holds `max_locks_per_transaction * (max_connections +
  max_prepared_transactions)` slots, 6400 on a default configuration, so around 3.5 years
  of history approaches the ceiling and more exceeds it, aborting with `out of shared
  memory`.

**Why not just fix 0007.** The obvious move is to rewrite 0007's history loop to commit
in chunks. It is not available. 0007 has already been applied on every deployed database
(it is recorded in `meta/_journal.json` alongside 0008 through 0014), and drizzle
checksums each migration file, so editing an applied migration's SQL breaks the checksum
on every one of those databases. That the production tables were empty when 0007 ran does
not help: the file is still recorded as applied, and the fix has to be additive and
forward, never a retroactive edit.

**What we shipped is an A+B hybrid, and that framing is deliberate.** #294 offered two
options: (A) provision the historical days outside the schema transaction in a chunked,
per-chunk-committing pass so cost is decoupled from database age, or (B) accept the cost
and document a runbook. We did both, because drizzle's one-transaction-per-file constraint
means (A) alone cannot cover 0007's own `RENAME` / foreign-key / copy statements, which
still run inside that single transaction no matter what we add afterwards.

- **(A), implemented.** A forward migration, `0015_click_events_backfill_days`, adds an
  idempotent plpgsql helper `click_events_backfill_days(chunk_size int DEFAULT 200)` that
  drains distinct historical days out of the `DEFAULT` partition into dated partitions, up
  to `chunk_size` days per call, reusing the existing `click_events_ensure_partition`. The
  worker drives it through `backfillClickPartitions`, which loops with **each chunk in its
  own committed transaction** so locks release between chunks and the footprint stays
  bounded regardless of how old the database is. The chunk size is
  `CLICK_EVENTS_BACKFILL_CHUNK_DAYS` (default `200`), chosen against the same lock math:
  ~5 slots per day-partition, so 200 days is ~1000 slots per chunk, comfortably under the
  default 6400 ceiling. It is deliberately **not** wired into the worker's steady-state
  maintenance loop, because it is a one-time adoption or repair step, not a recurring one.
- **(B), documented.** The residual that (A) cannot remove is 0007's own single
  transaction: the `RENAME`, the two foreign keys on `links` and `workspaces`, and the
  copy all still run under one `ACCESS EXCLUSIVE` / `SHARE ROW EXCLUSIVE` hold. For that,
  `SELF-HOSTING.md` carries an operator runbook: run the migrate step in a maintenance
  window, expect click writes and link create/edit to stall for its duration, and size
  `max_locks_per_transaction` for a large history using the lock math above.

Calling this out explicitly matters so it is not mistaken for a silent downgrade to
docs-only. The provisioning cost, the part that grew without bound with database age, is
genuinely decoupled and committed in chunks. Only the fixed structural cost of 0007's own
statements remains a single transaction, and the runbook is there to cover exactly that
irreducible part.

**A fresh install does not backfill history, and that is settled here.** The obvious
question the backfill raises is whether a fresh install should backfill too. It should
not, and does not. The `DEFAULT` partition guarantees that a write for an unprovisioned
day never fails, it simply lands in `DEFAULT`, and the worker's normal
`ensureClickPartitions` window drains recent days into dated partitions on its regular
pass. So old days are provisioned lazily, on demand, and a fresh install has no legacy
rows to migrate in the first place. Only a self-hoster adopting the partitioned schema
*with* pre-existing legacy click rows needs `backfillClickPartitions`, and for them it
runs decoupled and chunk-committing rather than inside the schema transaction.

**Revisit if** the per-chunk default ever proves wrong for a real adopter's hardware
(raise `CLICK_EVENTS_BACKFILL_CHUNK_DAYS`, but only alongside a raised
`max_locks_per_transaction`), or if a future drizzle release offered a way to bound the
lock hold of a structural migration itself, which would let the runbook shrink.

### OAuth: the nonce and the button shipped together, and Google went first

**Found by a security review (#263): `OAuthService` verified the algorithm, audience,
issuer and JWKS signature on an ID token, but never checked a `nonce`.** Audience
pinning stops a token minted for a different application; it does nothing to stop a
token minted for *this* application from being replayed a second time. For as long as
Google's tokens stay valid — about an hour — anyone who obtained one (a compromised
client, a logged URL, a leaky proxy) could `POST` it to `/auth/oauth` and get a session.

**Why this sat filed rather than fixed until now.** The realistic exposure was low: no
sign-in button existed anywhere in the web app, so the only callers were deliberate
ones. But a *half* fix — accepting a nonce when present, warning when absent — would
have meant shipping a version that still accepted an unbound token from whichever
caller forgot to send one, which is worse than not fixing it at all: it looks fixed
without being fixed. So the nonce and the client that generates it had to ship in the
same change, and did not until there was a reason to build the client.

**The nonce lives in the browser's memory, not a cookie.** `GoogleButton` generates 32
random bytes once per mount, hands them to Google's Identity Services SDK as the
`nonce` config (which the SDK embeds in its authorize request, and Google mints into
the returned token's `nonce` claim), and sends the same value to `POST /auth/oauth`
alongside the ID token. `OAuthService.verify` now requires the token's `nonce` claim to
match, in constant time, or refuses the sign-in. An httpOnly cookie set by a
server-minted-nonce endpoint would be marginally more robust against a proxy that logs
full request bodies — but it is also a new endpoint, a new cookie, and everything that
comes with one, to close a gap narrower than the one this closes: a bare stolen ID
token (a log, a URL, a shared device) can no longer be replayed, because the attacker
does not also have the in-memory nonce the legitimate attempt generated. Required from
the day the button ships, not optional: there was never a released version of this
endpoint that accepted an unbound token from a real caller, so there is no
compatibility to preserve.

**Google first, Apple plumbed but not shipped.** `OAuthService` already carried Apple's
issuer, JWKS endpoint and algorithms — cheap to keep, since the verifier is generic —
but nothing here builds an Apple button. Apple's native flow expects the SHA-256 *of*
the nonce rather than the nonce itself, a wrinkle this change does not resolve because
there is no Apple client yet to resolve it for. `OAuthService.enabled("apple")` stays
`false` until `APPLE_OAUTH_CLIENT_ID` is set, which it never is out of the box — same
"a provider with no client id is switched off, not misconfigured" rule Google used to
follow before today.

**Revisit if** an Apple button gets built. `verify()`'s nonce check is already
provider-agnostic (it compares the claim to what the caller supplies); what is missing
is a per-provider hashing step before that comparison for Apple's native SDK, and it
should be added in the same change as the Apple button, for the same reason Google's
nonce shipped with Google's button.

---

## Part 5 — Open questions for you

1. **Is the v1 Mongo database still live?** Decides whether the import script matters (G9).
2. **Do you have a Google Safe Browsing API key?** Decides whether the scan claim is honest (A10).
3. **Which domain will host redirects?** The fixtures use `snap.to`. Needed before CloudFront and
   ACM can be provisioned.
4. **RDS or an external free-tier Postgres?** Costed in the architecture doc — RDS burns the $100
   credit in about six months, external Postgres in about six years.
