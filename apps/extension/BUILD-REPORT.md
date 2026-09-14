# SnapURL Chrome Extension — Round-3 Integration Build Report

**Branch:** `feat/extension-prod` (local only — never pushed)
**Integration date:** 2026-09-10
**Base:** `af057c4` (Round-1 spec) off `origin/main` `587a03e`
**Tracks merged:** Track B `e6e7440` + Track C `13bb669`
**Result:** full verify **PASS** — type-check clean, 119/119 tests green, loadable
`dist/` built, CWS zip packaged.

> Integration was performed in an isolated worktree
> (`$KIROCREW_SCRATCH/snapurl-ext-r3`, throwaway branch `integrate/ext-r3`) to
> avoid the shared-worktree collision hazard, then fast-forwarded onto
> `feat/extension-prod`. `pnpm install --prefer-offline` + `pnpm build:packages`
> were run first so `@snapurl/contract` was built before type-check/tests.

---

## 1. What was integrated

**Track B — capture & create surface** (popup + background + create features):
popup production state machine (domain picker, custom alias, UTM builder, inline
QR panel, recent search + rows with copy/click-badge/sparkline), background
service worker context-menu ("Shorten with SnapURL") + keyboard-command shorten +
notifications, `api-client` gains `listDomains()` + `ScopeError`, new pure libs
`qr.ts` / `utm.ts`, the shared `i18n.ts` + `_locales/en/messages.json`, manifest
bumped to 1.1.0 with `contextMenus`+`commands` and the widened manifest test.

**Track C — configure, onboard, package, ship** (options + polish + assets):
options page Test-connection + show/hide key + domain-picker fallback +
CORS/`chrome.runtime.id` display + onboarding stepper, pure `onboarding.ts`
state machine, full `styles.css` rewrite (SnapURL tokens + `prefers-color-scheme`
dark mode), `scripts/package.mjs` CWS packaging, `STORE-LISTING.md`,
`store-assets/`, README update, `.gitignore` for build/zip artifacts.

---

## 2. Conflicts resolved

The two tracks were built against a frozen file/class boundary (SPEC §5.4), so
they own **disjoint files**. The only overlap and the one semantic reconciliation:

### 2.1 `apps/extension/package.json` — auto-merged, both kept
Git's `ort` strategy merged this without a conflict marker because B and C edited
different sections. Verified both survived:
- B: `dependencies.qrcode "^1.5.4"`, `devDependencies["@types/qrcode"] "^1.5.5"`.
- C: `scripts.package "node scripts/package.mjs"`.
- (`version` stays `2.0.0` — the pre-existing npm-workspace version at the base,
  independent of the CWS manifest version `1.1.0`. Not changed by the merge.)

### 2.2 `pnpm-lock.yaml` — regenerated, not hand-merged
After both merges, `pnpm install --prefer-offline` was re-run. The lockfile was
already consistent (no delta; qrcode/@types/qrcode entries from B present, policy
check passed with 777 entries). No hand-editing.

### 2.3 i18n reconciliation — TWO mechanisms collapsed into ONE
B created the shared `src/lib/i18n.ts` (`t(key, subs?)` over `chrome.i18n` with a
`setFallbackMessages()` test map) + `_locales/en/messages.json`. C shipped a
**standalone** `src/lib/i18n-local.ts` with its own `t()` and an inline
`OPTIONS_MESSAGES` camelCase catalog, explicitly "to fold into Track B's shared
`_locales` at Round-3 integration." Reconciled minimally, keeping **every**
user-facing string from both tracks:
- **Folded** all of C's options/onboarding keys into
  `_locales/en/messages.json` in the chrome `{message, description}` format
  (alphabetized), so there is one catalog the runtime reads via `chrome.i18n`.
- **Rewired** `options.ts` to import `t` from the shared `./lib/i18n.js` (drop the
  `i18n-local` `t`), and call `setFallbackMessages(OPTIONS_MESSAGES)` at module
  load **before** `OPTIONS_MARKUP` is built (the markup calls `t()` at eval time;
  under vitest/happy-dom there is no `chrome.i18n`, so the fallback catalog must be
  registered first).
- **Thinned** `i18n-local.ts` to export only the plain `OPTIONS_MESSAGES` fallback
  map (its `t()` removed) — kept as the non-browser fallback source, mirroring the
  `_locales` entries. One `t()` mechanism now, no behavior change to strings.

No other file conflicted (confirmed via `git diff --diff-filter=U` = empty after
each merge).

---

## 3. Full verification output

Run from the integrated tree with `@snapurl/contract` pre-built:

| Step | Command | Result |
|---|---|---|
| Type-check | `pnpm --filter @snapurl/extension type-check` | **clean** (`tsc --noEmit`, 0 errors) |
| Tests | `pnpm --filter @snapurl/extension test` | **119 passed / 119** across 11 files |
| Build | `pnpm --filter @snapurl/extension build` | loadable `dist/` produced |
| Lint | `pnpm --filter @snapurl/extension lint` | no-op stub (`echo "no lint configured"`) — **no lint tool configured** in this package |
| Package | `pnpm --filter @snapurl/extension package` | `snapurl-extension-1.1.0.zip` (306.4 KiB) |

### 3.1 Test breakdown (119 total)
```
src/lib/storage.test.ts       5
src/lib/onboarding.test.ts    9   (Track C)
src/manifest.test.ts         12   (widened: activeTab,storage,contextMenus,commands; version 1.1.0)
src/lib/api-client.test.ts   19   (listDomains, ScopeError, slug/utm)
src/background.test.ts       10   (Track B: context-menu + command + notify)
src/options.test.ts          20   (Track C: test-connection verdicts, onboarding, reconciled i18n)
src/popup.test.ts            20   (Track B: domain picker, alias, UTM, QR, recent search)
src/lib/short-url.test.ts    10
src/lib/qr.test.ts            4
src/lib/active-url.test.ts    7
src/lib/utm.test.ts           3
```

### 3.2 Bundle sizes (raw / in CWS zip)
```
dist/popup.js       823.7 kB  (bundles qrcode — 74 refs; ~87% compressible)
dist/options.js     754.6 kB  (does NOT bundle qrcode — 1 incidental match)
dist/background.js  745.4 kB  (does NOT bundle qrcode — 1 incidental match)
dist/styles.css       8.6 kB
CWS zip total       306.4 KiB compressed (all assets + _locales)
```

### 3.3 MV3 / least-privilege invariants (re-checked at integration)
- `manifest_version: 3`, `version: "1.1.0"`, `default_locale: "en"`.
- `permissions: ["activeTab","storage","contextMenus","commands"]` — exactly the
  spec set.
- `host_permissions: []` — **empty, unchanged** (least privilege preserved).
- CSP intact: `script-src 'self'; object-src 'self'; base-uri 'self'`.
- **No `eval(` or `new Function(`** in any `dist/*.js` (grep-verified) — MV3-safe,
  no remote code.
- `dist/_locales/en/messages.json` present and shipped.

---

## 4. Complete feature list now on the branch

- **F1** Context-menu "Shorten with SnapURL" (page + right-clicked link).
- **F2** Keyboard-shortcut shorten (`Ctrl/Cmd+Shift+U`, remappable).
- **F3** Custom alias input with client-side slug validation.
- **F4** Domain picker (read-only, from `GET /domains`; honors `defaultDomain`).
- **F5** Collapsible UTM builder → `utm` on create.
- **F6** Inline QR generate + download (PNG/SVG), bundled `qrcode`, no CDN.
- **F7** Recent-links server-side search (debounced `GET /links?search=`).
- **F8** Per-recent-row copy + open + click-count badge.
- **F9** Inline sparkline from `Link.sparkline` (zero extra requests).
- **F10** Typed error states: auth / missing-scope (`ScopeError`) / rate-limit /
  offline / generic.
- **F11** i18n via `chrome.i18n` + shared `_locales/en/messages.json` (one mechanism).
- **F12** Options Test-connection (live `GET /links?limit=1`) with verdict line +
  show/hide key + resolved `chrome.runtime.id`.
- **F13** First-run 3-step onboarding (URL → key → CORS + test).
- **F14** CWS packaging script + `STORE-LISTING.md` + store-assets + README.
- **F15** Dark-mode aware styling with SnapURL tokens (`prefers-color-scheme`).

Deferred/cut per spec: bulk/clone/edit (F16), add/verify domains (F17, admin-only),
api-key/webhook mgmt (F18), conversions (F19), content scripts/`<all_urls>` (F20),
deep-link config (F21).

---

## 5. Flagged backend dependencies (operator actions — no backend changes made)

Carried verbatim from SPEC §9. None require touching `apps/api`/`apps/web`/contract:

1. **`EXTENSION_ORIGINS` must include the extension id in production.** After
   loading unpacked, add `chrome-extension://<id>` (comma-separated) to the API's
   `EXTENSION_ORIGINS` and restart the API. Dev reflects any origin, so this only
   bites in production. Onboarding surfaces the id + the exact `.env` line.
2. **Domains are read-only from the extension.** Add/verify are `@Roles("admin")`,
   unreachable by an API key; the picker lists only.
3. **API-key / webhook management stays in the webapp** (admin-only).
4. **QR is client-side only** — no backend QR endpoint used or needed.
5. **Per-link analytics needs `analytics:read`** — degrades to the zero-cost
   `Link.sparkline`/`clicks` glance when the scope is absent.
6. **Recent list is workspace-wide**, not extension-created-only (`ListLinksQuery`
   has no creator/key filter). UI copy states "Recent links in this workspace".

---

## 6. popup.js bundle-size note (Track B flag) — DECISION: leave as-is (follow-up)

Track B flagged that `popup.js` is ~824 kB raw because it bundles the full
`qrcode` encoder. Investigated at integration:
- Only `popup.js` carries qrcode; `options.js`/`background.js` do **not**.
- The shipped CWS zip is **306 KiB compressed total** — the qrcode payload
  compresses ~87% and is far under Chrome Web Store limits.

**Decision: leave as-is for this release.** Lazy-loading or SVG-only-path swaps are
real optimizations but touch Track B's `popup.ts`/`qr.ts` late in integration with
test churn and QR-download regression risk, for no store-limit or correctness
benefit today. Documented as a **follow-up** for a future version:
- Option A: dynamic `import()` of `qrcode` only when the QR panel opens.
- Option B: use only the pure `toSvgString` path (drops the PNG canvas encoder)
  if PNG download is deprioritized.

---

## 7. How to load unpacked + test manually

1. Build: `pnpm --filter @snapurl/extension build` → produces `apps/extension/dist/`.
2. Chrome → `chrome://extensions` → enable **Developer mode** → **Load unpacked**
   → select `apps/extension/dist/`.
3. Copy the extension id shown on the card. If testing against a **production** API,
   add `chrome-extension://<id>` to that API's `EXTENSION_ORIGINS` and restart it.
   (Against a dev API this is not needed — dev reflects any origin.)
4. First install opens **Options in onboarding mode**: enter API base URL (origin,
   no `/api/v1`), paste a `snap_live_…` key (needs `links:read`+`links:write`;
   `domains:read` for the picker; `analytics:read` optional), then **Test connection**
   — a green verdict finishes onboarding.
5. Smoke the surfaces:
   - **Popup**: click the toolbar icon on any http(s) tab → pick domain / alias /
     UTM → **Shorten** → verify the short URL, Copy, Open, and the QR panel
     (Download PNG / SVG). Then the **Recent** section: search, per-row copy,
     click badge, sparkline.
   - **Context menu**: right-click a page or a link → **Shorten with SnapURL** →
     expect a notification + the short URL on the clipboard.
   - **Command**: press `Ctrl/Cmd+Shift+U` (remap at `chrome://extensions/shortcuts`).
   - **Options**: show/hide key, copy origin / `.env` line, Test connection verdicts.
   - **Dark mode**: toggle OS dark mode → the popup/options should re-theme.
6. CWS zip: `pnpm --filter @snapurl/extension package` →
   `apps/extension/snapurl-extension-1.1.0.zip` for the developer dashboard.

---

## 8. Acceptance

Integrated tree passes **type-check + test (119/119) + build + package**; lint has
no tool configured (stub passes). All committed on `feat/extension-prod`. **Nothing
was pushed** (repo has an `origin` remote but no push was performed; verify with
`git log origin/main..feat/extension-prod`).
