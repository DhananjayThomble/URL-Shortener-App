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

**Redis.** Every use I had for it — rate limit counters, the click queue, caching — is served by
DynamoDB, SQS, or CloudFront at a lower cost. Adding ElastiCache would nearly double the monthly
bill to solve problems this system does not have yet.

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

7. **GeoIP uses CloudFront's `CloudFront-Viewer-Country` header.** Free and accurate at country
   level, which is all the contract reports. No MaxMind database to ship or license.

8. **Click limits may overshoot slightly.** The counter is a DynamoDB conditional write; under
   concurrent clicks a hard cap can be exceeded by a handful. The alternative is a synchronous
   read-modify-write on the hot path, which costs more latency than the accuracy is worth for a
   feature whose main use is "roughly 500 beta invites."

9. **Uniques reset at 00:00 UTC and a visitor on a new network counts twice.** This is inherent to
   the cookieless daily-salt design the product promises, not a bug. It should be said plainly in
   the UI rather than discovered by a confused user.

10. **Safe Browsing is behind a feature flag, defaulting off.** It needs a Google API key I do not
    have. With the flag off, links are created with `safeBrowsing.status = "clean"` and a
    `checkedAt` of now. **This is the assumption most likely to mislead** — the UI will claim links
    are scanned when they are not. Either set `GOOGLE_SAFE_BROWSING_API_KEY` or soften the copy.

11. **Email is stubbed.** Invitations, verification and password reset write to a `logs/outbox/`
    directory instead of sending. SES needs a verified domain and a sandbox exit request. The
    interface is `MailerPort`, so wiring SES is one adapter.

12. **No rate limit on the redirect path.** Rate limiting the dashboard API protects the database;
    rate limiting redirects would mean a state lookup on the hot path, and CloudFront already
    absorbs volume. Abuse protection there belongs at WAF, which costs money.

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

---

## Part 5 — Open questions for you

1. **Is the v1 Mongo database still live?** Decides whether the import script matters (G9).
2. **Do you have a Google Safe Browsing API key?** Decides whether the scan claim is honest (A10).
3. **Which domain will host redirects?** The fixtures use `snap.to`. Needed before CloudFront and
   ACM can be provisioned.
4. **RDS or an external free-tier Postgres?** Costed in the architecture doc — RDS burns the $100
   credit in about six months, external Postgres in about six years.
