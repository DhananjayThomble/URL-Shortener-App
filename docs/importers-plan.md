# SnapURL Importers — Round 1 Scoping Plan

Status: **SCOPING ONLY** — no feature code in this PR. This doc + the open
decisions below are the deliverable. Branch `scope/importers`, base
`origin/main` @ 112060e.

Goal: let users import their existing short links from other platforms
(Bitly, YOURLS, Kutt, Dub) into their current SnapURL workspace.

---

## 1. Link-create surface (confirmed against the code, not memory)

### Bulk create already exists
`POST /links/bulk` — `apps/api/src/links/links.controller.ts:67`, service
`links.service.ts:233`. An importer calls **this**, not the single-create path.

**Request** — `BulkCreateLinksInput` (`packages/contract/src/link.ts:177`):
```
{ links: Array<Record<string, unknown>> }   // 1..100 rows, envelope only
```
- The array is **deliberately un-typed at the envelope** — each row is parsed
  against `CreateLinkInput` *inside the service* so one bad row is reported per
  row instead of 400-ing the whole request.
- **Hard cap: 100 rows per batch.** An importer of a large export MUST chunk
  into batches of ≤100. (Each row costs a Safe Browsing lookup, so the cap is
  intentional and won't be raised for us.)

**Each row** — `CreateLinkInput` (`link.ts:108`). Fields an importer can set:
| Field | Type / notes |
|---|---|
| `destination` | **required**, must pass `HttpUrl` (rejects `javascript:`/`data:`/metadata IPs) |
| `domain` | **required** — a workspace domain string (e.g. `snapurl.in`); resolved per-row |
| `slug` | optional back-half, regex `^[a-zA-Z0-9._-]*$`; empty ⇒ server generates one |
| `tags` | `string[]` |
| `comment` | ≤280 chars |
| `redirectType` | `301`/`302` (default `302`) |
| `expiresAt` / `activatesAt` | ISO strings (nullable) |
| `utm` | `{source,medium,campaign,content}` |
| `social` | `{title,description,image}` |
| `forwardQuery`,`deepLink`,`hideReferrer`,`publicPreview` | booleans w/ defaults |

**Response** — `BulkCreateLinksResult`: `{created, failed, results[]}` where
`results` is same length & order as input; each entry is a discriminated
`BulkLinkOutcome` (`{ok:true, index, link}` or `{ok:false, index, destination, error}`).

### Batch semantics that shape the whole design
- **All-or-nothing per batch.** If ANY row fails validation/collision, the
  whole batch writes **nothing** (`created:0`) and every row comes back with an
  error. So an importer must present the per-row failures and let the user
  resubmit a corrected batch — the good rows can't be duplicated on retry.
- **Slug collision behavior (already built, no new server code needed):**
  - Explicit slug already in DB ⇒ that row fails: *"…/slug is already taken."*
  - Explicit slug duplicated **within** the batch ⇒ later row fails: *"Row N already asks for /slug."*
  - **Generated** slug that collides ⇒ silently **redrawn** (retry loop).
  - There is **NO overwrite path**. "Overwrite existing" is not currently
    expressible and would be a separate server feature (see decision Q1).

### No home for these export fields (⇒ dropped-on-import, must be flagged in UI)
- **Original created-at** — `createdAt` is DB-set at insert; the contract has
  no field to backfill it. Imported links get the import timestamp. (Decision Q2.)
- **Title** — there is no top-level `title` on a link. Closest homes:
  `comment` (≤280) or `social.title`. Recommend mapping export "title" →
  `comment` (visible in list) and flagging it as approximate.
- **Per-link click counts / historical analytics** — no ingestion path; dropped.
- **Anything platform-specific** (Bitly campaigns/groups, Dub folders as a
  first-class entity, tag colors, QR styling) — dropped or flattened to `tags`.

### Web surface an importer plugs into
Client-side bulk already exists: `web/src/components/links/bulk-create-panel.tsx`
→ hook `useBulkCreateLinks` (`web/src/lib/api/hooks/links.ts:109`) → `POST /links/bulk`.
The Links page (`web/src/app/(app)/links/page.tsx`) has a **"Bulk create"**
toggle button — the natural sibling entry point for **"Import"**.

Fixtures parity: `web/src/lib/api/fixtures.ts:763` handles `/links/bulk` and
mirrors the all-or-nothing + per-row-outcome contract. Any importer E2E runs in
fixtures mode, so the importer must produce rows the existing fixture handler
accepts — **no fixture changes needed for the wire format**, only for any new
route (there is none — we reuse `/links/bulk`).

---

## 2. Where the importer belongs — **RECOMMENDATION: client-side parser in `web/`**

Parse the export file in the browser, map to `CreateLinkInput[]`, chunk into
≤100-row batches, and call the existing `POST /links/bulk`. **No new backend
endpoint.**

Rationale:
- **Reuses the built, tested surface.** Bulk-create already handles auth,
  workspace scoping, domain resolution, slug collision/redraw, Safe Browsing,
  the projection outbox, activity records, and per-row reporting. A server-side
  importer would either duplicate all of that or just wrap `bulkCreate()` — no
  gain.
- **Auth/workspace:** the browser is already authenticated to the current
  workspace; imports land there by construction (answers Q3 = current workspace).
- **File size:** exports are small (thousands of rows of text). Parsing CSV/JSON
  client-side is trivial and keeps large uploads off the API Lambda.
- **Partial-failure reporting** is already surfaced per-row by
  `BulkCreateLinksResult`; the importer maps its own parse errors + the server's
  row errors into one review list before/after submit.
- **Dedupe** against existing links is enforced server-side (slug collision);
  the client can additionally pre-warn using `useLinks({search})` but the server
  is the source of truth.

Server-side would only be justified if we needed to (a) preserve original
created-at (needs a new privileged field), (b) ingest historical click data, or
(c) run a background job for >100-row single-shot imports. None are in scope for
Round 1; if the user wants created-at preservation (Q2=yes) that becomes a
small dedicated server change, flagged as its own PR.

---

## 3. Source export formats & field mapping

> Formats below reflect each platform's real, current export. Column names vary
> by plan/version, so each importer normalizes case/whitespace and matches on a
> set of known header aliases rather than exact strings.

### Bitly — **CSV** ("Export" from the dashboard)
Typical columns: `Bitlink` (short URL), `Long URL` / `Original URL`,
`Title` / `Name`, `Tags`, `Created` (ISO), `Total Clicks`, `Campaign`, `Group`.
| Export | SnapURL |
|---|---|
| Long URL / Original URL | `destination` |
| Bitlink back-half (path of the short URL) | `slug` (validate regex; skip/suffix on collision) |
| Title / Name | `comment` (approx) — flagged |
| Tags | `tags` |
| Created | dropped unless Q2=preserve |
| Total Clicks, Campaign, Group | dropped (Campaign/Group could → `tags`) |

### YOURLS — **CSV export** (admin "Tools → Export") or the **API**
CSV columns commonly: `keyword` (back-half), `url` (long), `title`, `timestamp`,
`ip`, `clicks`. (Also exportable via `yourls-api.php?action=...`.)
| Export | SnapURL |
|---|---|
| url | `destination` |
| keyword | `slug` |
| title | `comment` (approx) |
| timestamp | dropped unless Q2 |
| clicks, ip | dropped |
Recommend CSV as the v1 path (no credentials needed); API import is a later add.

### Kutt — **JSON/CSV** (v3 CSV export of links; API returns JSON)
Fields: `address` (back-half), `target` (long URL), `description`, `banned`,
`created_at`, `visit_count`, `expire_in`, `domain`.
| Export | SnapURL |
|---|---|
| target | `destination` |
| address | `slug` |
| description | `comment` |
| expire_in / expiration | `expiresAt` (parse to ISO if present) |
| created_at | dropped unless Q2 |
| visit_count, banned | dropped |

### Dub — **CSV export**
Columns: `Short link` / `Domain`+`Key`, `Destination URL` / `URL`, `Title`,
`Description`, `Tags`, `Created At`, `Clicks`, `Archived`.
| Export | SnapURL |
|---|---|
| Destination URL / URL | `destination` |
| Key (back-half) | `slug` |
| Title | `comment` (approx) |
| Description | `social.description` |
| Tags | `tags` |
| Created At | dropped unless Q2 |
| Clicks, Archived, Folder | dropped |

**Common dropped-on-import set (all sources):** original created-at (unless Q2),
historical click counts, platform-specific grouping/campaign metadata beyond
tags, QR/branding styling. The importer's review screen lists exactly what it
will drop before the user commits.

---

## 4. Decisions the USER must make (blocking the build round)

- **Q1 — Slug collision policy** when an imported back-half already exists in the
  workspace: **skip that row** / **import with a suffixed slug** (`spring` →
  `spring-1`) / **overwrite the existing link** (⚠ needs a NEW server capability;
  `/links/bulk` cannot overwrite today). Recommendation: **skip** (safest,
  no server change), with the review screen naming skipped rows.
- **Q2 — Original created-at:** **preserve** the source's created date (⚠ needs a
  new privileged server field on create — a small dedicated PR) / **set to import
  time** (no server change). Recommendation: **import time** for v1; add
  preservation later if wanted.
- **Q3 — Workspace target:** import into the **current workspace only**? (This is
  the natural, recommended default and what client-side gives for free.) Or must
  we support choosing a target workspace in the importer UI?
- **Q4 — Domain assignment:** imported short links carry the *source's* domain
  which SnapURL doesn't own. Import all links under a **single chosen SnapURL
  workspace domain** (recommended — user picks it in the UI, same as
  BulkCreatePanel's domain dropdown), correct?

---

## 5. Proposed PR breakdown ("one importer per PR")

Each PR gated on: **one in-session independent review + a dedicated E2E for that
importer (fixtures mode) + CI gate green + desktop layout preserved + fixtures
parity**. Isolated git worktree per PR.

- **PR1 — Import core (foundation).**
  - A generic parser interface `ImportSource { id, label, detect(file), parse(text): { rows: MappedRow[]; dropped: DroppedField[] } }`.
  - A generic CSV mapper (header-alias matching) + the chunk-to-≤100 + call
    `useBulkCreateLinks` + aggregate per-row results pipeline.
  - The **"Import" entry point** on the Links page (sibling to "Bulk create"):
    upload/paste → pick SnapURL domain → preview mapped rows + dropped-fields
    notice → submit → per-row outcome list (reusing BulkCreatePanel's result UI).
  - Wires the Q1 collision policy and Q3/Q4 defaults chosen above.
  - E2E: generic CSV import happy path + all-or-nothing failure surfaced.
  - *No per-source code yet* — ships with one built-in "Generic CSV" source so
    the core is independently reviewable and testable.
- **PR2 — Bitly** source (header aliases + mapping + its own E2E fixture file).
- **PR3 — YOURLS** source (CSV; API deferred).
- **PR4 — Kutt** source (JSON + CSV).
- **PR5 — Dub** source (CSV).

Rationale for this split over "one big PR": PR1 makes the risky shared plumbing
(chunking, all-or-nothing UX, dropped-field disclosure, collision policy)
reviewable on its own; PR2–PR5 are then small, near-mechanical format adapters
that each get a focused review + fixture. If Q1=overwrite or Q2=preserve, insert
a **PR0 — server capability** (new endpoint field) before PR1, because those
change the wire contract.

---

## 6. Confirmed non-conflations
- `packages/database/scripts/import-v1.ts` is a **v1→v2 data migration**, not a
  competitor importer — untouched by this feature.
- Issue #267 (deployment-profiles epic) is unrelated.
- No importer feature and no importer GitHub issue exist today.
