# SnapURL browser extension

A Manifest V3 Chrome extension that shortens the active tab against **your own**
SnapURL API, with a custom alias, a domain picker, a UTM builder, inline QR
codes, and searchable recent links. It hard-codes no host: you point it at your
API base URL and paste a scoped API key, both of which live only in the
browser's extension storage.

## What it does

- **Shorten the active tab** — one click from the toolbar popup, from the
  right-click context menu, or with a keyboard shortcut (default
  `Ctrl/Cmd+Shift+U`, remappable at `chrome://extensions/shortcuts`).
- **Custom alias** — choose your own slug instead of a random one.
- **Domain picker** — pick from the short domains configured on your workspace
  (read-only; add/verify domains in the web app).
- **UTM builder** — tag `source` / `medium` / `campaign` / `content` inline.
- **Inline QR** — generate and download a PNG or SVG QR for the new short link.
- **Recent links** — search your workspace's recent links, copy or open them,
  and glance at click counts.
- Distinct, recoverable states for loading, empty, an unshortenable page
  (`chrome://`, `file://`, the extension's own pages), a rejected or
  under-scoped API key, rate limiting, and being offline.

It requests only `activeTab`, `storage`, `contextMenus`, and `commands` — and
**no host permissions**. It reads the current tab's URL through `activeTab` only
when you ask it to shorten, and calls your configured API with `fetch`, relying
on the API's opt-in CORS allowlist (see
[Cross-origin access](#cross-origin-access-self-hosted-api)).

## Prerequisites

- Node.js **>= 22** and pnpm (the monorepo uses corepack).
- A running SnapURL API you can reach over http(s).
- A scoped API key (`snap_live_…`) with the `links:read` and `links:write`
  scopes (plus `domains:read` for the domain picker; `analytics:read` is
  optional). Create one from the dashboard **Developers** page.

## Build

From the repo root:

```bash
pnpm install
pnpm build:packages                       # workspace packages must be built first
pnpm --filter @snapurl/extension build
```

This bundles the service worker, popup, and options page with esbuild and copies
the static assets into `apps/extension/dist/`. `dist/` is a build artifact and is
gitignored.

To type-check and run the unit tests:

```bash
pnpm --filter @snapurl/extension type-check
pnpm --filter @snapurl/extension test
```

## Load it unpacked

1. Build (above) so `apps/extension/dist/` exists.
2. Open `chrome://extensions`.
3. Turn on **Developer mode** (top-right).
4. Click **Load unpacked** and choose `apps/extension/dist`.

The **guided first-run onboarding** opens automatically on first install.

## Configure

First install opens a three-step onboarding: **(1)** your API base URL, **(2)**
your `snap_live_…` key, **(3)** the CORS allowlist step with a built-in **Test
connection**. You can also reach these any time from the extension's **Settings**
(the options page, or the Settings link in the popup):

- **API base URL** — the origin of your SnapURL API, e.g. `https://your-host`
  (no trailing `/api/v1`; the extension appends the `api/v1` prefix itself).
- **API key** — a `snap_live_…` key with `links:read` + `links:write`. Use the
  **Show/Hide** toggle to check it; it is stored as a secret and never logged.
- **Default short domain** — the domain new links are created under, e.g.
  `go.example`. Required: the API rejects a create with an empty domain.
- **Test connection** — runs a real `GET /links?limit=1` and reports a verdict:
  connected, key rejected (401/403), or a network/CORS failure with the exact
  fix. This is the fastest way to diagnose setup problems.

Settings are stored in `chrome.storage.local`.

## Package for the Chrome Web Store

```bash
pnpm --filter @snapurl/extension package
```

This builds and zips the **contents** of `dist/` (so `manifest.json` is at the
archive root, as the store requires) into
`apps/extension/snapurl-extension-<version>.zip`. Upload that zip in the Chrome
Web Store developer dashboard. See [`STORE-LISTING.md`](./STORE-LISTING.md) for
the listing copy, permission justifications, screenshot plan, and promo-tile
guidance.

## Cross-origin access (self-hosted API)

In production the API's CORS is origin-restricted. To let the extension call a
self-hosted API from its `chrome-extension://<id>` origin, add that origin to the
API's `EXTENSION_ORIGINS` allowlist (a comma-separated list, empty by default).
The options page shows your extension's exact origin and the ready-to-paste
`EXTENSION_ORIGINS=chrome-extension://<id>` line, each with a Copy button. In
development any origin is reflected, so this only matters in production. See the
API's [`.env.example`](../api/.env.example) and the CORS notes in
[SELF-HOSTING.md](../../SELF-HOSTING.md).

## Design notes

- **No remote code.** MV3 forbids it; everything is bundled into self-contained
  ESM files and the content security policy is `script-src 'self'`.
- **Least privilege.** `activeTab` + `storage` + `contextMenus` + `commands`
  only, and no `<all_urls>` / host permissions.
- **Contract-typed.** All requests and responses are validated against
  `@snapurl/contract`, so the extension can never drift from the API's wire
  format.
- **SnapURL design tokens, light + dark.** Styling adopts the web app's palette
  (Cobalt accent, WCAG-2.2-AA ink scale) and follows `prefers-color-scheme`.
- **i18n-ready.** User-facing strings resolve through a `t()` helper backed by
  `chrome.i18n`, so locales can be added without touching the controllers.
- **Testable core.** The popup and options controllers take their effects
  (storage, API client, active tab, clipboard, test-connection probe,
  onboarding flag) as injected dependencies, so they are covered by DOM tests
  under happy-dom without launching a browser. The manifest's least-privilege
  shape is asserted by a parsing test.
