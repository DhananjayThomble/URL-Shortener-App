# SnapURL Chrome Extension — Production Spec (Round 1)

**Status:** Design spec for the Round-2 build. This is the source of truth the
Track B / Track C implementation sessions build from.
**Target:** `apps/extension` — Manifest V3, currently shipped at v1.0.0 (popup +
options + background, `activeTab` + `storage` only).
**Audit date:** 2026-09-10. Grounded in a read of `apps/extension/**`,
`packages/contract/src/{link,workspace,analytics}.ts`, and the `apps/api`
links / domains / analytics / developers / workspaces modules + auth guard +
CORS config at commit `587a03e` (main).

> **Assumption stated up front (required by the task):** the overnight
> competitor run did **not** finish — `research/competitor-analysis-2026-09/per-product/`
> is empty. All competitor-informed feature decisions below therefore rely on
> (a) the committed `docs/COMPETITIVE-GAP-ANALYSIS.md` (SnapURL vs InApp), and
> (b) the 10 comparison dimensions in
> `research/competitor-analysis-2026-09/00-MASTER.md`. Where a decision would
> normally lean on a per-product datapoint we did not have, it is called out as
> **[assumed]** and the fallback reasoning is given.

---

## 1. Goal & scope

### Goal
Turn the functional-but-minimal v1.0.0 extension into a **polished, production-grade,
Chrome-Web-Store-shippable** product: a fast in-browser surface for shortening
the active tab against the user's own SnapURL API, with the link-creation power
users expect from Bitly/Dub/Short.io browser extensions (custom alias, domain
picker, UTM builder, inline QR), plus recent-link glance/search — all while
staying strictly least-privilege and self-host-first.

### Hard constraints (non-negotiable, from the audit)
1. **Do not modify the webapp or backend.** The extension is a pure API client.
   Any missing endpoint is documented as a flagged dependency (§9), never patched
   into the backend in this work.
2. **Least privilege.** No `<all_urls>`. Adding `contextMenus` and `commands` is
   allowed and expected. Nothing else. `host_permissions` stays empty — the API
   base URL is user-configured and reached by `fetch` relying on the API's opt-in
   CORS allowlist.
3. **No remote code (MV3).** Everything bundled into self-contained ESM via
   esbuild; CSP stays `script-src 'self'; object-src 'self'; base-uri 'self'`.
   Any QR/UTM logic must be a bundled dependency or local code, never a CDN call.
4. **Contract is the single source of truth.** All request/response shapes come
   from `@snapurl/contract`; the client parses responses through the zod schemas
   (as `lib/api-client.ts` already does) so the extension can never drift.
5. **Self-host friendly.** No hard-coded host. The http/https scheme derivation
   in `lib/short-url.ts` (loopback + host-match heuristic) must be preserved.
6. **Secret hygiene.** The API key is a secret stored in `chrome.storage.local`
   and never logged. Preserve this.

### What's already built (v1.0.0 — keep, refactor as needed, do not regress)
- **Popup** (`src/popup.ts`): states for needs-config, not-shortenable,
  needs-domain, shorten (button → loading → result with copy/open), and recent
  links (loading/empty/list). Injected-deps (`PopupDeps`) pattern for headless
  testing. Distinct `auth` / `rate-limit` / `generic` error kinds.
- **Options** (`src/options.ts`): API base URL (validated http(s)), API key
  (password field), default short domain. Saves to `chrome.storage.local`,
  "Settings saved." confirmation.
- **Background** (`src/background.ts`): MV3 event-driven service worker; seeds
  empty settings on install and opens options on first run.
- **lib**: `api-client.ts` (typed errors: `ApiError`/`AuthError`/`RateLimitError`/
  `MissingDomainError`/`NetworkError`; `createLink`, `listLinks`), `storage.ts`
  (settings + `normalizeApiBaseUrl` + `hasCredentials`), `short-url.ts` (scheme
  derivation), `active-url.ts` (shortenable-URL guard).
- **Build**: `build.mjs` (esbuild, 3 entry points, copies `public/` → `dist/`;
  `dist/` gitignored). **Tests**: 810 lines of vitest+happy-dom across
  popup/options/manifest/api-client/storage/short-url/active-url.
- **Manifest guard test** (`src/manifest.test.ts`): asserts MV3,
  `permissions ⊆ {activeTab, storage}`, `host_permissions.length === 0`, CSP
  forbids remote/inline, version `=== "1.0.0"`, popup+options+icons present.

> ⚠️ **The manifest test currently hard-asserts the exact v1.0.0 permission set
> and `host_permissions.length === 0`.** Adding `contextMenus`/`commands` (both
> are `permissions`, not host permissions) means the `allowed` set in that test
> MUST be widened to `{activeTab, storage, contextMenus, commands}` in the same
> PR that touches the manifest, or `pnpm test` fails. `host_permissions.length === 0`
> stays true and must not be relaxed. The version assertion may move to 1.1.0 (§7).

### What "production-grade" adds (the delta this spec defines)
Right-click context-menu shorten · keyboard-shortcut shorten · custom-alias input ·
domain **picker** (dropdown from `GET /domains`, not free-text) · UTM builder ·
inline QR generation + download · recent-links search/filter + per-link copy ·
richer/consistent error+empty+offline states · i18n-ready strings · options polish +
inline "test connection" · first-run onboarding · Web-Store packaging + listing assets.

---

## 2. Integration audit (authoritative endpoint map)

All routes are under the global prefix **`api/v1`** (`env.API_PREFIX`, default
`api/v1`). Base URL is user-configured (`settings.apiBaseUrl`), normalized to an
origin with no trailing slash; the client appends `/api/v1/...`.

### 2.1 Auth model
- **Bearer token in the `Authorization` header.** `AuthGuard` branches on the
  credential: a value starting with `snap_` → API-key path; otherwise JWT. The
  extension always uses an **API key** (`snap_live_…`).
- **API keys act with a fixed `editor` role** (never owner/admin — see
  `auth.guard.ts::actorFromApiKey`). This is decisive: any endpoint decorated
  `@Roles("admin")` is **unreachable by an API key**, regardless of scope.
- **Scopes** (from `API_SCOPES` in `workspace.ts`): `links:read`, `links:write`,
  `analytics:read`, `domains:read`, `domains:write`, `conversions:write`.
  A missing scope → `403 "This API key is missing the \"<scope>\" scope."`
- **401** (`UnauthorizedException`): missing/invalid key → `AuthError`.
- **429**: throttler; `Retry-After` header parsed by the client → `RateLimitError`.

### 2.2 Endpoints the extension consumes

| Method & path | Role gate | Scope gate | Body / query (contract) | Returns | Extension use |
|---|---|---|---|---|---|
| `POST /api/v1/links` | `editor` ✅ reachable | `links:write` | `CreateLinkInput` | `Link` (201) | **Core** shorten |
| `GET  /api/v1/links` | — | `links:read` | `ListLinksQuery` | `LinkList` | Recent list + search |
| `GET  /api/v1/links/{id}` | — | `links:read` | `IdParam` (UUID) | `Link` | (optional) refresh one link's stats |
| `GET  /api/v1/domains` | — | `domains:read` | — | `Domain[]` | **Domain picker** |
| `GET  /api/v1/analytics` | — | `analytics:read` | `AnalyticsQuery` `{range, linkId?}` | `Analytics` | (optional) per-link quick stats |

**Not usable by the extension (API-key = editor, these are `@Roles("admin")`):**
- `GET/POST/DELETE /api/v1/api-keys`, `.../webhooks` (developers) — admin only.
- `POST/DELETE /api/v1/domains`, `POST /api/v1/domains/{id}/verify` — admin only.
  → The extension can **list** domains (`domains:read`) but cannot add/verify them.
  Domain management stays in the webapp; the picker is read-only.
- `PATCH /api/v1/workspaces/current` — admin only. (`GET /workspaces/current` has
  **no** `@Scope`, only auth — see §9 note; do not rely on it.)

**Reachable but out of scope for a shortener extension:** `PATCH/DELETE /links/{id}`,
`POST /links/bulk`, `POST /links/{id}/clone`, `GET /links/export` (all `editor` +
`links:write`/`links:read`). Documented so Track B knows they exist; not built now.

### 2.3 `CreateLinkInput` — the exact create contract (from `link.ts`)
Required: **`destination`** (`string.min(1).pipe(HttpUrl)` — must be a real
http(s) URL) and **`domain`** (`string.min(1)` — **an empty/absent domain is a
hard 400**; this is why the popup gates on a default domain today).
Optional the extension will use: **`slug`** (`/^[a-zA-Z0-9._-]*$/` or `""`),
**`utm`** (`{source?, medium?, campaign?, content?}`), and (deferred) `tags`,
`comment`, `redirectType`, `expiresAt`, etc. The client already parses the input
through `CreateLinkInput.parse` and the response through `Link.parse`.

`Link` carries `domain` + `slug` but **no absolute short URL** — the extension
synthesizes it via `buildShortUrl` (scheme derivation preserved). `Link` also
carries `clicks`, `uniqueClicks`, `sparkline` (30 zero-filled ints), `status`,
`safeBrowsing.status` — all available for the recent-list glance and quick stats.

### 2.4 `ListLinksQuery` — recent + search (from `link.ts`)
`{ status: "all"|"active"|… (default all), search?, tag?, folder?, domain?,
limit: 1..100 (default 50), cursor? }`. Server-side `search` and `domain` filters
exist, so recent-links **search is a server query**, not client-only filtering.
`LinkList = { items: Link[], total, nextCursor? }` — cursor pagination available
for "load more".

### 2.5 CORS / `EXTENSION_ORIGINS` (the load-bearing dependency)
`resolveCorsOrigins` (config/cors-origins.ts): in **development** any origin is
reflected (`true`); in **production/test** the allowlist is
`[WEB_ORIGIN, ...EXTENSION_ORIGINS]`. `EXTENSION_ORIGINS` is **optional, empty by
default** (`env.ts`), comma/space-separated. `credentials: false`,
`allowedHeaders: ["Content-Type","Authorization"]`, methods include GET/POST.
→ **To hit a production API, the operator must add `chrome-extension://<id>` to
`EXTENSION_ORIGINS`.** Onboarding (§6) MUST surface the extension's own id
(`chrome.runtime.id`) and copy-paste instructions. `.env.example` already carries
a commented `EXTENSION_ORIGINS=chrome-extension://…` example.

### 2.6 Conventions the extension MUST follow / MUST NOT break
- Append `api/v1` yourself; store base URL as bare origin (already enforced by
  `normalizeApiBaseUrl`).
- Always send an explicit non-empty `domain` on create.
- Parse every response through the contract schema; surface typed errors.
- Never log the API key. Never request broad host permissions.
- Keep controllers testable via injected deps (`PopupDeps`/`OptionsDeps` pattern).
- `POST /links` needs `slug` matching `/^[a-zA-Z0-9._-]*$/`; validate client-side
  before submit to give an inline message instead of a 400.

---

## 3. Feature set — include / cut decisions

Each decision is tied to the audit (§2) or the gap analysis. Legend: ✅ include
(this cycle), 🔸 include (thin/optional), ❌ cut/defer.

| # | Feature | Decision | Rationale |
|---|---|---|---|
| F1 | **Context-menu "Shorten this link/page"** (`contextMenus`) | ✅ | Table-stakes for Bitly/Dub extensions; shorten a page or a right-clicked link without opening the popup. Least-privilege (`contextMenus` perm only). Handled in background SW; result via notification + clipboard. |
| F2 | **Keyboard shortcut shorten** (`commands`) | ✅ | `commands` is a cheap, standard power-user affordance (dimension 10 UX). Default suggested `Ctrl+Shift+U` / `Cmd+Shift+U`, user-remappable at `chrome://extensions/shortcuts`. Opens popup or shortens active tab directly. |
| F3 | **Custom alias input** | ✅ | `CreateLinkInput.slug` already supported; every branded-link competitor (Rebrandly/Short.io) leads with this. Optional field in popup; client-side regex validation. |
| F4 | **Domain picker (dropdown)** | ✅ | `GET /domains` (`domains:read`) exists and returns `Domain[]`. Replaces free-text default-domain reliance with a live picker; still honors `settings.defaultDomain` as the pre-selected value. Read-only (add/verify are admin-only, §2.2). |
| F5 | **UTM builder** | ✅ | `CreateLinkInput.utm` supported; UTM tagging is a named gap-analysis dimension (link features) and a daily B2B/marketer need. Pure client → maps to `utm` on create. Collapsible "Add campaign tags" section. |
| F6 | **Inline QR generate + download (PNG/SVG)** | ✅ | Webapp already ships `qrcode@^1.5.4` (browser ESM); bundle the same lib — no CDN, MV3-safe. QR of the freshly created short URL, download as PNG/SVG. Parity with Bitly/Uniqode QR emphasis (dimension 5). |
| F7 | **Recent-links search / filter** | ✅ | `ListLinksQuery.search` + `domain` are server-side. Adds a search box over the recent list (debounced query), not just the top 5. |
| F8 | **Per-recent-link copy button + short-URL + click count** | ✅ | `Link` carries `clicks`/`uniqueClicks`; cheap glance value. Each recent row gets copy + open + a "N clicks" badge. |
| F9 | **Per-link quick stats glance** (7d sparkline / totals) | 🔸 | `Link.sparkline` (30 pts) is already on every list item — render a tiny inline sparkline with **zero extra requests**. A deeper `GET /analytics?linkId=` drill-in is **optional** and only if `analytics:read` scope is present; degrade gracefully when it isn't. |
| F10 | **Richer auth / rate-limit / offline / scope error states** | ✅ | Client already distinguishes `AuthError`/`RateLimitError`/`NetworkError`/`MissingDomainError`; production adds a distinct **missing-scope** message (403 body names the scope) and an **offline** banner, each with a clear recovery CTA. |
| F11 | **i18n-ready strings** (`_locales/en/messages.json` + `chrome.i18n`) | ✅ | Cheap to scaffold now, expensive to retrofit. All user-facing strings via a `t()` helper reading `chrome.i18n.getMessage`; ship `en` only, structured for later locales. Dimension 10 (onboarding/UX) + Web-Store quality bar. |
| F12 | **Options / settings polish + "Test connection"** | ✅ | Add a Test-connection button that does a real `GET /links?limit=1` and reports auth/scope/network verdicts inline — the single biggest setup-failure reducer given the CORS/scope/domain gotchas (§2.5). Show resolved `chrome.runtime.id` for the CORS allowlist. |
| F13 | **First-run onboarding** | ✅ | Guided 3-step: (1) API base URL, (2) paste `snap_live_…` key + scopes needed, (3) add `chrome-extension://<id>` to `EXTENSION_ORIGINS` (with copy button) → Test connection. Replaces the bare "open options on install". |
| F14 | **Chrome Web Store packaging + listing assets** | ✅ | Already have a zip step; production adds a documented, scripted packaging path + store-listing copy, screenshots checklist, privacy-disclosure text (least-privilege story is a selling point), and promo tile guidance. |
| F15 | **Dark-mode aware styling / SnapURL tokens** | ✅ | v1.0.0 CSS is light-only. Adopt `prefers-color-scheme` and align tokens with the web app's palette (see §5) so it doesn't clash in dark browsers. |
| F16 | Bulk create / clone / edit / delete links | ❌ defer | Endpoints exist and are reachable, but these are dashboard workflows, not a "shorten the active tab" surface. Out of scope; noted for a future version. |
| F17 | Add/verify custom domains from the extension | ❌ cut | `@Roles("admin")` — **unreachable by an API key**. Would require backend changes (forbidden). Picker is read-only. |
| F18 | API-key / webhook management in-extension | ❌ cut | Admin-only endpoints, unreachable by API key. Stays in the webapp Developers page. |
| F19 | Conversion recording (`POST /conversions`, `conversions:write`) | ❌ cut | Server-to-server attribution concern, not a browser-action feature. |
| F20 | Content scripts / on-page link rewriting / `<all_urls>` | ❌ cut | Violates least-privilege constraint; `activeTab` + context menu cover the need without broad host access. |
| F21 | Deep-link / app-routing config | ❌ defer | Gap analysis marks `deepLink` as an incomplete backend feature; nothing for the extension to drive yet. |

**Resulting manifest permission set:** `["activeTab", "storage", "contextMenus", "commands"]`,
`host_permissions: []`. (Manifest test `allowed` set updated to match — §1 warning.)

---

## 4. UI / UX definition

### 4.1 Popup (primary surface, 360px wide)
State machine (extends the current one; `data-testid` hooks preserved for tests):

1. **needs-config** — no API key. CTA → options/onboarding.
2. **not-shortenable** — `chrome://`, `file://`, extension pages, blank tab.
   Shows the reason from `shortenableUrl()`. Recent list still loads.
3. **needs-domain** — no domain available (no default + `GET /domains` empty/failed).
   CTA → options; if `GET /domains` returned rows, auto-resolve instead of blocking.
4. **ready (main)** — the production shorten form:
   - Active page title + URL (truncated, `activeTab`).
   - **Domain** select (F4): populated from `GET /domains`; default = `settings.defaultDomain`
     if present else first live domain. Loading + error fallbacks.
   - **Custom alias** input (F3), optional, placeholder "auto", inline regex validation.
   - **"Add campaign tags (UTM)"** disclosure (F5): source/medium/campaign/content.
   - Primary **Shorten this page** button → loading → **result**.
5. **result** — short URL (link + Copy + Open), **Copied** confirmation, a
   **QR** panel (F6: preview + Download PNG / Download SVG), and "Shorten another".
6. **error** — typed: auth (→ open options), missing-scope (names the scope),
   rate-limit (with retry seconds), offline (retry), generic. `data-kind` preserved.
7. **recent** — header, **search box** (F7, debounced → `GET /links?search=`),
   list of rows each with short URL, click badge (F8), inline sparkline (F9),
   Copy + Open. Loading / empty / inline-error states.

Interaction flows:
- **Shorten:** ready → (pick domain / alias / UTM) → Shorten → POST → result (QR
  auto-rendered) → Copy auto-offered. On failure → typed error, form re-enabled.
- **Context menu (F1):** right-click page or link → "Shorten with SnapURL" →
  background creates link with default domain → clipboard write + `chrome.notifications`
  success/among error toast (no popup needed).
- **Command (F2):** shortcut → open popup focused on Shorten (or direct-shorten
  active tab per a setting).

### 4.2 Options page
Sections: **Connection** (API base URL, API key [password, with show/hide],
**Test connection** button + verdict line), **Defaults** (default domain — now a
picker seeded from `GET /domains` once connected, falling back to text when not),
**Shortcuts** (link to `chrome://extensions/shortcuts`), **About/CORS** (resolved
`chrome.runtime.id` + copy button + the `EXTENSION_ORIGINS` instruction). Keep
`normalizeApiBaseUrl` validation and "Settings saved." confirmation.

### 4.3 Onboarding (F13)
First-install opens options in **onboarding mode**: a 3-step stepper (URL → key →
CORS allowlist + test). Completing step 3 with a green Test-connection verdict
marks onboarding done (a `chrome.storage.local` flag) and future opens show the
normal options view.

### 4.4 Visual style (SnapURL tokens)
Adopt the web app's palette rather than the ad-hoc v1 values. Base tokens (align
with `web` globals; verify exact hex against `web/src/app/globals.css` at build
time, do not invent): brand/accent = the web app's Cobalt accent, neutral
ink/surface scale, success green, error red. Provide **both** light and dark via
`prefers-color-scheme` (F15). Keep the 360px popup compact; system font stack.
Respect reduced-motion. All interactive elements keyboard-reachable with visible
focus and accessible names (the repo's a11y bar — accessible-name selectors are
also what the tests key on).

---

## 5. Architecture & module boundary (for parallel Round-2 tracks)

Two tracks build in **separate git worktrees off `feat/extension-prod`** and merge
without conflict because they own disjoint files. Shared files that both need are
**frozen by this spec** (their shape is defined here) so neither track edits the
other's territory.

### 5.1 Shared foundation (build FIRST, by whoever starts; tiny, then frozen)
These land in one small prep commit before B and C diverge, OR Track B owns them
and Track C rebases once they exist. To avoid a race, **Track B owns the shared
lib/manifest**; Track C treats them as read-only inputs and only adds its own files.

- `src/lib/i18n.ts` — `t(key, subs?)` wrapper over `chrome.i18n.getMessage` with a
  test-friendly fallback map. (F11)
- `_locales/en/messages.json` — all strings. Both tracks add keys; **append-only**,
  alphabetized, so merges are trivial (no reordering).
- `public/manifest.json` — add `contextMenus` + `commands` + a `commands` block +
  `_locales` `default_locale`. **Track B owns edits;** Track C does not touch it.
- `src/manifest.test.ts` — widen `allowed` permission set. **Track B owns.**

### 5.2 Track B — capture & create (popup + background + create features)
**Owns:**
- `src/popup.ts` (+ `popup.test.ts`) — the ready/result state machine, domain
  picker, alias, UTM disclosure, QR panel, recent search + rows.
- `src/background.ts` (+ `background.test.ts`) — install seeding (keep),
  `contextMenus` registration + click handler (F1), `commands` handler (F2),
  `chrome.notifications` success/error.
- `src/lib/api-client.ts` (+ test) — add `listDomains(settings)` →
  `Domain[]` (parsed via `@snapurl/contract` `Domain`), and a distinct
  **missing-scope** error (`ScopeError extends AuthError`, message from 403 body).
  Extend `CreateLinkParams` with `slug`, `utm`.
- `src/lib/qr.ts` (+ test) — pure wrapper over bundled `qrcode`: `toPngDataUrl`,
  `toSvgString`. No DOM, testable.
- `src/lib/utm.ts` (+ test) — pure builder mapping form fields → `utm` object,
  dropping empties.
- `public/popup.html` (markup lives in `POPUP_MARKUP`; html is the mount only).

**Adds deps:** `qrcode@^1.5.4` + `@types/qrcode@^1.5.5` to `apps/extension/package.json`
`dependencies`/`devDependencies` (match the web app's versions exactly). esbuild
bundles it into `popup.js` — MV3-safe (no eval; verify `qrcode` build has no
`Function`/`eval`; if a bundler warning appears, pin to the SVG string path which is pure).

**Acceptance (B):** `pnpm --filter @snapurl/extension type-check` clean;
`pnpm --filter @snapurl/extension test` green (new popup/background/qr/utm/api-client
tests included); `pnpm --filter @snapurl/extension build` produces a loadable
`dist/`; manifest test passes with the widened permission set.

### 5.3 Track C — configure, onboard, package, ship (options + polish + assets)
**Owns:**
- `src/options.ts` (+ `options.test.ts`) — Test-connection (injected
  `testConnection` dep hitting `GET /links?limit=1`), show/hide key, domain
  picker fallback, CORS/`chrome.runtime.id` display, onboarding-mode stepper.
- `src/lib/onboarding.ts` (+ test) — pure step-state machine + the
  onboarding-complete storage flag helpers.
- `public/options.html`, `public/styles.css` — SnapURL tokens, light+dark,
  onboarding layout (F15; §4.4). **Track C owns `styles.css` entirely** (B renders
  into classes C defines — B may add class *names* documented here; the CSS rules
  are C's).
- `public/icons/*` — production icon set if regenerated (else keep).
- Packaging + docs: `scripts/package.mjs` (or a `package` npm script) that builds +
  zips `dist/` → `apps/extension/snapurl-extension.zip`; `STORE-LISTING.md`
  (title, short + long description, category, privacy justification for
  `activeTab`/`storage`/`contextMenus`/`commands`, screenshot checklist, promo
  tiles); update `apps/extension/README.md` for the new features.
- `_locales/en/messages.json` — C adds its own keys (append-only).

**Acceptance (C):** type-check clean; options/onboarding tests green; `styles.css`
renders both schemes (documented visual check); `package` script yields a valid
Web-Store zip; `STORE-LISTING.md` complete; README updated.

### 5.4 Conflict-avoidance contract
- Only **Track B** edits `manifest.json`, `manifest.test.ts`, `api-client.ts`,
  `popup.ts`, `background.ts`.
- Only **Track C** edits `options.ts`, `styles.css`, `options.html`, packaging,
  store docs, README.
- `_locales/en/messages.json` is **append-only + alphabetized** (both tracks add;
  no edits/reorders) → line-level merges only.
- `src/lib/i18n.ts` is created once (Track B) and thereafter read-only.
- The **class-name registry** (below) is the interface between B's markup and C's CSS.

**Class-name registry (frozen):** `popup`, `popup__header`, `popup__title`,
`popup__form`, `field`, `field__label`, `field__input`, `field__error`,
`domain-select`, `alias-input`, `utm-disclosure`, `utm-grid`, `result`,
`result__url`, `result__actions`, `qr`, `qr__preview`, `qr__actions`,
`recent`, `recent__search`, `recent__list`, `recent__item`, `recent__clicks`,
`recent__sparkline`, `error`, `banner--offline`, `options`, `options__section`,
`onboarding`, `onboarding__step`, `onboarding__verdict`, `btn`, `btn--primary`,
`btn--ghost`, `linkish`. Both tracks use exactly these; adding one requires editing
this registry (a spec change), which keeps the boundary honest.

---

## 6. Onboarding & CORS (the setup story)

The #1 setup failure is a working key that still can't reach a **production** API
because the extension origin isn't in `EXTENSION_ORIGINS`. Onboarding must:
1. Collect base URL (validated) → key (`snap_live_…`, with a note it needs at
   least `links:read` + `links:write`; `domains:read` for the picker;
   `analytics:read` optional for stats).
2. Show `chrome-extension://<chrome.runtime.id>` with a **Copy** button and the
   exact `.env` line: `EXTENSION_ORIGINS=chrome-extension://<id>` (plus a note it's
   comma-separated and that dev reflects any origin so this only matters in prod).
3. **Test connection** → interpret: 200 = ready; 401/invalid = key rejected;
   403 = names the missing scope; network/CORS failure = "add the origin above to
   EXTENSION_ORIGINS and restart the API". Only a green result finishes onboarding.

---

## 7. Manifest changes (exact)

```jsonc
// public/manifest.json (delta from v1.0.0)
"version": "1.1.0",                      // was 1.0.0 — production feature release
"default_locale": "en",                  // required once _locales/ exists
"permissions": ["activeTab", "storage", "contextMenus", "commands"],
"host_permissions": [],                  // unchanged — MUST stay empty
"commands": {
  "shorten-active-tab": {
    "suggested_key": { "default": "Ctrl+Shift+U", "mac": "Command+Shift+U" },
    "description": "Shorten the current tab with SnapURL"
  }
}
// action/options_ui/background/CSP/icons unchanged
```
The manifest test (`manifest.test.ts`) must be updated in lock-step: widen the
`allowed` permissions set to include `contextMenus`+`commands`; change the version
assertion from `1.0.0` to `1.1.0` (or relax to a semver check); keep the
`host_permissions.length === 0` and CSP assertions **unchanged**.

---

## 8. Test strategy

Extend the existing **vitest + happy-dom, injected-deps** pattern — no real browser.
- **Pure libs** (`qr.ts`, `utm.ts`, `onboarding.ts`, extended `short-url.ts`):
  plain unit tests, no DOM.
- **api-client**: extend `api-client.test.ts` with `listDomains` happy/parse-error,
  the new `ScopeError` (403 body → named scope), and `createLink` with `slug`/`utm`
  in the body. Use injected `fetchImpl` (already the pattern).
- **popup**: extend `popup.test.ts` — domain picker populated/empty/failed, alias
  validation, UTM mapping into the create body, QR panel render + download wiring
  (inject a fake `qr` dep), recent search query, per-row copy/click badge/sparkline.
  Assert via accessible names / `data-testid`, never CSS.
- **background**: new `background.test.ts` — context-menu registration on install,
  click handler creates a link with the default domain and writes clipboard +
  notifies (inject `chrome`-shaped deps), command handler dispatch.
- **options**: extend `options.test.ts` — Test-connection verdicts (200/401/403/
  network via injected `testConnection`), show/hide key, onboarding step
  transitions and the completion flag.
- **manifest**: update assertions per §7.
- **CI:** the repo's `CI gate` runs `pnpm -r … test`; the extension's tests run
  inside it. Both tracks keep the suite green; do not weaken an assertion to pass.

Coverage target: every new pure lib ≥ its neighbors' bar; every popup/options
state has at least one test. `@snapurl/contract` must be built first
(`pnpm build:packages`) or type-check/tests fail in a fresh worktree.

---

## 9. Flagged dependencies & missing-backend notes (design around, do NOT patch)

1. **`EXTENSION_ORIGINS` must include the extension id in production.** Not a code
   gap — an operator action. Extension surfaces the id + instructions (§6). No
   backend change.
2. **No "recent links by this key / created-by-extension" filter.** `ListLinksQuery`
   filters by `status/search/tag/folder/domain`, not by API key or creator. Recent
   list shows the **workspace's** recent links, not just extension-created ones.
   Acceptable; state it in UI copy ("Recent links in this workspace"). No backend change.
3. **Domains are read-only from the extension.** Add/verify are `@Roles("admin")`,
   unreachable by an API key (§2.2). Picker lists; management stays in the webapp.
4. **`GET /workspaces/current` has no `@Scope` decorator** (only auth). It would
   return the workspace's `defaultDomain`, which could seed the picker — but relying
   on an unscoped endpoint is fragile and could change. **Design decision:** seed
   the default domain from `GET /domains` + `settings.defaultDomain` only; do **not**
   depend on `/workspaces/current`. No backend change requested.
5. **Per-link analytics needs `analytics:read`.** Many keys won't have it. F9's
   drill-in must degrade to the zero-cost `Link.sparkline`/`clicks` glance when the
   scope is absent (detect via the 403 scope error and hide the drill-in). No backend change.
6. **QR is client-side only.** No backend QR endpoint is needed or used; bundle
   `qrcode`. This is intentional and MV3-safe.

None of these require touching `apps/api`, `apps/web`, or the contract. If a future
version wants extension-created-link filtering or an extension-scoped stats
endpoint, that is a **separate, explicitly-approved** backend change — out of scope here.

---

## 10. Build & acceptance summary

- Branch: `feat/extension-prod` (worktree), local only, **never pushed**.
- Round 2 = Track B ∥ Track C in separate worktrees off this branch, disjoint files
  per §5.4, merged back to `feat/extension-prod`.
- Each track's Definition of Done: `type-check` clean, `test` green (no weakened
  assertions), `build` yields a loadable `dist/`, plus its track-specific artifacts
  (B: features working in a manual unpacked load; C: packaging zip + store docs +
  onboarding). Round 3 = integration pass (both tracks merged), full manual
  unpacked-load smoke against a live/dev API, and Web-Store submission prep.
- Global invariants re-checked at integration: least privilege (no `<all_urls>`),
  no remote code / CSP intact, contract-parsed responses, key never logged,
  webapp/backend untouched.
