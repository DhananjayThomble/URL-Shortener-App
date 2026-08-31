# SnapURL browser extension

A Manifest V3 Chrome extension that shortens the active tab against **your own**
SnapURL API, copies the short link, and lists your recent links. It hard-codes
no host: you point it at your API base URL and paste a scoped API key, both of
which live only in the browser's extension storage.

## What it does

- One-click shorten the current tab and copy the result to the clipboard.
- Open the short link in a new tab.
- Show your most recent links.
- Distinct states for loading, empty, an unshortenable page (`chrome://`,
  `file://`, the extension's own pages), a rejected API key, and rate limiting.

It requests only two permissions — `activeTab` and `storage` — and no host
permissions. It reads the current tab's URL through `activeTab` and calls your
configured API with `fetch`, relying on the API's opt-in CORS allowlist (see
[Cross-origin access](#cross-origin-access-self-hosted-api)).

## Prerequisites

- Node.js **>= 22** and pnpm **11.24.0** (the monorepo uses corepack).
- A running SnapURL API you can reach over http(s).
- A scoped API key (`snap_live_…`) with the `links:read` and `links:write`
  scopes. Create one from the dashboard **Developers** page (or `POST /api-keys`).

## Build

From the repo root:

```bash
pnpm install
pnpm --filter @snapurl/extension build
```

This bundles the service worker, popup and options page with esbuild and copies
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

The options page opens automatically on first install.

## Configure

Open the extension's **Settings** (the options page, or the Settings link in the
popup) and set:

- **API base URL** — the origin of your SnapURL API, e.g. `https://your-host`
  (no trailing `/api/v1`; the extension appends the `api/v1` prefix itself).
- **API key** — a `snap_live_…` key with `links:read` + `links:write`.
- **Default short domain** — the domain new links are created under, e.g.
  `go.example`. This is required: the API rejects a create with an empty domain,
  so the popup will not shorten until a default domain is set.

Settings are stored in `chrome.storage.local`. The API key is a secret and is
never logged.

## Package for the Chrome Web Store

Build, then zip the contents of `dist/`:

```bash
pnpm --filter @snapurl/extension build
cd apps/extension/dist && zip -r ../snapurl-extension.zip .
```

Upload the resulting `apps/extension/snapurl-extension.zip` in the Chrome Web
Store developer dashboard.

## Cross-origin access (self-hosted API)

In production the API's CORS is origin-restricted. To let the extension call a
self-hosted API from its `chrome-extension://<id>` origin, add that origin to the
API's `EXTENSION_ORIGINS` allowlist (a comma-separated list, empty by default).
See the API's [`.env.example`](../api/.env.example) and the CORS notes in
[SELF-HOSTING.md](../../SELF-HOSTING.md). You can find the extension's id on the
`chrome://extensions` card after loading it unpacked. This is the opt-in origin
allowlist added in the CORS work that this extension depends on.

## Design notes

- **No remote code.** MV3 forbids it; everything is bundled into
  self-contained ESM files and the content security policy is `script-src 'self'`.
- **Least privilege.** `activeTab` + `storage` only, no `<all_urls>`.
- **Testable core.** The popup and options controllers take their effects
  (storage, API client, active tab, clipboard) as injected dependencies, so they
  are covered by DOM tests under happy-dom without launching a browser. The
  manifest's least-privilege shape is asserted by a parsing test.
